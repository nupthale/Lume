/**
 * ============================================================
 * 18 — Long Worker：长任务的队列、取消、暂停/恢复（生产框架骨架）
 * ============================================================
 *
 * 解决三个正交问题（对照 04-hitl 只覆盖了 WAITING_APPROVAL 一支）：
 *   1. 排队：per-session 互斥 + 冲突策略（queue / preempt 打断）
 *   2. 取消：AbortController 贯穿三层（LLM 流式 / 工具执行 / loop 边界），
 *      外加消息协议修补（tool_calls 必须有配对 tool result）
 *   3. 暂停/恢复：轮次边界 checkpoint 落库 + 状态机驱动恢复
 *
 * 文件结构（生产框架视角，非 demo）：
 *   types.ts      本文件：状态机、领域类型
 *   store.ts      持久化契约（runs / messages / 幂等记录 / lease）
 *   tools.ts      Tool 接口 + 幂等执行器（防副作用重放）
 *   run.ts        AgentRun：agent loop + 三层取消 + 协议修补（核心）
 *   scheduler.ts  SessionScheduler：互斥、queue/preempt、优雅停机
 *   recovery.ts   启动恢复：lease 扫描 + 消息校验 + 重入队
 *   index.ts      组装与用法
 *
 * 设计总纲（一句话）：把状态当数据（DB 里的 messages + 状态机），
 * 不当执行现场（内存里的 Promise/闭包）。队列、取消、暂停、崩溃恢复
 * 全部变成对同一份状态机的操作。
 */

import type OpenAI from 'openai';

// ---------------------------------------------------------------------------
// 消息与领域类型
// ---------------------------------------------------------------------------

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
/** SDK 返回的 assistant 消息（含 tool_calls） */
export type AssistantMessage = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;

export type SessionId = string;
export type RunId = string;
export type ToolCallId = string;

/** 一次 run 的输入：新用户消息 + 冲突策略 */
export interface RunInput {
  sessionId: SessionId;
  /** 本次 run 新增的 user 消息（preempt 场景 = 打断旧任务的新指令） */
  userMessage: string;
  /** 会话已有 active run 时的冲突策略，见 scheduler.ts */
  onConflict: ConflictStrategy;
}

export type ConflictStrategy =
  /** 排队：当前 run 跑完后按 FIFO 开跑 */
  | 'queue'
  /** 打断：取消当前 run（补齐协议后落库），立刻带着新消息重跑 */
  | 'preempt';

/** 预算：任何循环都要有预算，耗尽不是失败而是可恢复的暂停 */
export interface Budget {
  maxSteps: number;
  /** 可选的 token 上限 / 墙钟 deadline，到点主动 abort（防止卡死在慢工具上） */
  maxTokens?: number;
  deadlineMs?: number;
}

// ---------------------------------------------------------------------------
// Run 状态机
// ---------------------------------------------------------------------------
//
//   QUEUED → RUNNING ──┬→ COMPLETED
//     ↑                ├→ WAITING_APPROVAL ──→ RUNNING      （审批通过）
//     │                ├→ WAITING_USER ──────→ QUEUED       （"继续"，预算追加）
//     │                ├→ CANCELLED                          （用户取消 / preempt）
//     │                └→ FAILED                             （可从 checkpoint 重放）
//     └── SHUTDOWN（优雅停机：RUNNING → QUEUED，等重启后恢复）
//
// 关键区分：
//   CANCELLED       是终态，不再自动恢复（但 messages 保留，preempt 的新 run 可见）
//   WAITING_USER    是暂停态，用户说"继续"就 resume（预算耗尽 / 用户暂停 / 超时）
//   WAITING_APPROVAL 是暂停态，由审批回调恢复（04-hitl 的场景，本目录只保留接口）
//   FAILED + lease 过期  由 recovery.ts 在启动时重新入队（崩溃恢复）

export type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'WAITING_USER'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

/** DB 里的 run 记录（真相源）。内存里的 AgentRun 只是它的执行投影 */
export interface RunRecord {
  runId: RunId;
  sessionId: SessionId;
  status: RunStatus;
  budget: Budget;
  /** 已消耗步数（checkpoint 持久化，恢复时继续累计而不是从 0 数） */
  stepsUsed: number;
  /** 发给审批端的 payload（WAITING_APPROVAL 时非空） */
  pendingApproval: ApprovalPayload | null;
  /** worker 租约：持有者 + 到期时间。心跳续期，过期视为 worker 已死 */
  lease: { workerId: string; expiresAt: number } | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalPayload {
  toolCallId: ToolCallId;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

/** 审批决定。注意 approved=false 有两种语义，必须区分（见 run.ts requestApproval） */
export interface ApprovalDecision {
  approved: boolean;
  /**
   * true = 这不是"人类拒绝"，而是 run 被取消/打断时对挂起 Promise 的解锁。
   * 语义分叉点：普通拒绝 → 喂 REJECTED_BY_HUMAN 给模型让它改口；
   * aborted → 终止整个 run，不产生"人类拒绝"的假象。
   */
  aborted?: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// 取消原因：abort 不只一种，原因决定 finalize 迁移到哪个状态
// ---------------------------------------------------------------------------

/**
 * AbortController.abort(reason) 的 reason（ES2022，Node 18+ 可从 signal.reason 取回）。
 * 不用裸字符串而用判别联合，是为了在 finalizeCancelled 里做穷尽 switch，
 * 编译器保证新增原因时必须处理所有迁移分支。
 */
export type AbortReason =
  /** 用户点了"停止"按钮 → 终态 CANCELLED */
  | { kind: 'USER_CANCEL'; requestedBy: string }
  /** 用户新消息打断（Trae 形态）→ 终态 CANCELLED，scheduler 立刻起新 run */
  | { kind: 'PREEMPT' }
  /** 墙钟 deadline 到点，主动掐断卡死的调用 → 暂停态 WAITING_USER（可恢复） */
  | { kind: 'TIMEOUT' }
  /**
   * 进程优雅停机（SIGTERM / k8s 滚动更新）→ 回到 QUEUED，
   * 重启后 recovery 重新调度。绝不标记 CANCELLED——部署不是用户的错。
   */
  | { kind: 'SHUTDOWN'; graceful: true };

/** 判断一个异常是否是 abort（兼容 OpenAI SDK 的 APIUserAbortError 与原生 AbortError） */
export function isAbortError(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true; // signal 已触发时，一切异常都按 abort 处理
  return e instanceof Error && /abort/i.test(e.name);
}

/** 工具执行结果：成功的 payload，或结构化的失败（失败也是信息，喂回模型） */
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };
