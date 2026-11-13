/**
 * ============================================================
 * run.ts — AgentRun：agent loop + 取消 + 暂停/恢复（本目录核心）
 * ============================================================
 *
 * 一个 AgentRun 实例 = 一次任务执行的内存投影（真相源在 store 的 RunRecord）。
 * 生命周期内它要正确处理：
 *
 * 【AbortController 的三种触发位置】（用户点名要考虑全的情况）
 *   位置 A：LLM 流式响应中 abort
 *     —— SDK 抛 APIUserAbortError，此刻 assistant 消息只聚合了一半
 *        （content 残缺 / tool_calls JSON 不完整）。
 *        处理：残缺消息【不入库】（局部变量自然丢弃），
 *        直接走取消收尾。此时不需要补 tool result——模型还没发出
 *        完整的 tool_calls，messages 里没有悬空的 call。
 *
 *   位置 B：工具执行中 abort
 *     —— 最危险的位置：副作用可能发生了一半。
 *        处理：(1) 幂等记录留在 IN_FLIGHT（见 tools.ts，防重放重执行）
 *              (2) 给被中断的 call 补一条 CANCELLED 的 tool result
 *              (3) 同一 assistant 消息里【后续还没执行的 call】也要
 *                  逐个补 SKIPPED 的 tool result —— 协议要求 assistant
 *                  里的每个 tool_call_id 都必须有配对的 tool 消息，
 *                  缺一个，恢复时带这条 messages 请求模型直接 400
 *
 *   位置 C：轮次边界（loop 开头）abort
 *     —— 最干净的位置，没有任何中间态，直接状态迁移 + 落库
 *
 *   位置 D（隐蔽）：审批等待中 abort
 *     —— WAITING_APPROVAL 时 run 挂在 await requestApproval 上。
 *        abort 必须同时 resolve 这个挂起的 Promise，否则 Promise 链
 *        永远不返回 → scheduler 的 await 卡死 + 内存泄漏。
 *        注意"approved=false"的语义分叉：
 *          人类拒绝 → 喂 REJECTED_BY_HUMAN 给模型，loop 继续（改口）
 *          abort 解锁 → 终止整个 run，绝不产生"人类拒绝了"的假象
 *
 * 【暂停/恢复】
 *   预算耗尽 / deadline / 用户暂停 → WAITING_USER（干净暂停，轮次边界）
 *   恢复 = 用户说"继续" → scheduler.resume(runId, 追加预算) →
 *   重新入队 → 本类 start() 从 store 加载 messages + stepsUsed 续跑。
 *   不需要恢复任何栈帧/闭包——状态就是数据，这就是重放便宜的原因。
 */

import type {
  AbortReason,
  ApprovalDecision,
  ApprovalPayload,
  AssistantMessage,
  Budget,
  Message,
  RunId,
  RunStatus,
  ToolResult,
} from './types.js';
import { isAbortError } from './types.js';
import type { RunStore } from './store.js';
import { ToolExecutor } from './tools.js';

// ---------------------------------------------------------------------------
// 模型客户端契约（LLM 调用抽象：run.ts 只依赖这个接口）
// ---------------------------------------------------------------------------

export interface ModelClient {
  /**
   * 非流式/流式由实现决定，但必须：
   *   1. 透传 signal（OpenAI SDK：create(params, { signal })）
   *   2. abort 时抛出可被 isAbortError 识别的异常
   *   3. 只返回【聚合完整】的 assistant 消息——半截 delta 由实现内部丢弃
   */
  complete(messages: Message[], signal: AbortSignal): Promise<AssistantMessage>;
}

/** 敏感操作白名单：命中则在执行前挂起等审批（04-hitl 的审批门原样搬来） */
export type ApprovalGate = (toolName: string, args: Record<string, unknown>) => boolean;

export interface AgentRunDeps {
  model: ModelClient;
  store: RunStore;
  executor: ToolExecutor;
  /** 审批门：返回 true 的工具执行前要过人（返回 null 表示不需要） */
  requiresApproval: ApprovalGate;
  /** 审批 UI 通道：把 payload 推给审批端（前端卡片 / 飞书审批 / IM） */
  notifyApprovalNeeded: (runId: string, payload: ApprovalPayload) => void;
  logger: (line: string) => void;
}

const LEASE_TTL_MS = 30_000;
const HEARTBEAT_MS = 10_000;

// ---------------------------------------------------------------------------
// 消息协议修补（崩溃恢复也复用，所以是模块级纯函数）
// ---------------------------------------------------------------------------

/**
 * 找出所有"悬空"的 tool call：assistant 消息里声明了 tool_calls，
 * 但 messages 里没有配对的 role:'tool' 消息。
 * 这是恢复前必须修掉的非法状态——带着悬空 call 请求模型会 400。
 */
export function findDanglingToolCalls(messages: Message[]): Set<string> {
  const declared = new Set<string>();
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray((m as AssistantMessage).tool_calls)) {
      for (const c of (m as AssistantMessage).tool_calls!) declared.add(c.id);
    }
    if (m.role === 'tool') answered.add((m as { tool_call_id: string }).tool_call_id);
  }
  for (const id of answered) declared.delete(id);
  return declared;
}

/** 生成一条配对的 tool result 消息 */
export function toolResultMessage(callId: string, result: ToolResult): Message {
  return {
    role: 'tool',
    tool_call_id: callId,
    content: JSON.stringify(result.ok ? result.data : { error: result.error }),
  };
}

// ---------------------------------------------------------------------------
// AgentRun
// ---------------------------------------------------------------------------

export class AgentRun {
  readonly runId: RunId;
  private record!: { sessionId: string; status: RunStatus; stepsUsed: number; budget: Budget };
  private messages: Message[] = [];

  /** 取消的三层共用这一个信号源 */
  private controller = new AbortController();
  /**
   * 审批挂起点（位置 D）：cancel() 除了 abort 还要 resolve 它。
   * 生产多 worker 版本它住在 pending tool-call registry（04-hitl 注释），
   * 单 worker 内存版就是这个字段。
   */
  private pendingApproval: ((d: ApprovalDecision) => void) | null = null;

  /** scheduler 等待 run 终态/暂停态的句柄 */
  readonly done: Promise<RunStatus>;
  private settleDone!: (s: RunStatus) => void;

  private heartbeat?: ReturnType<typeof setInterval>;
  private deadlineTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private deps: AgentRunDeps,
    runId: RunId,
  ) {
    this.runId = runId;
    this.done = new Promise((resolve) => (this.settleDone = resolve));
  }

  // -------------------------------------------------------------------------
  // 对外控制面
  // -------------------------------------------------------------------------

  /** 取消 run。幂等：重复调用安全 */
  cancel(reason: AbortReason): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort(reason); // 位置 A/B/C 的统一触发器
    // 位置 D：解锁审批挂起点。aborted=true 让 loop 走"终止"而非"人类拒绝"分支
    this.pendingApproval?.({ approved: false, aborted: true, reason: reason.kind });
    this.pendingApproval = null;
  }

  /** 审批回调入口（外部系统：前端 POST / 飞书事件 / 定时轮询到达） */
  handleApproval(decision: ApprovalDecision): void {
    const resolve = this.pendingApproval;
    this.pendingApproval = null;
    resolve?.(decision);
  }

  // -------------------------------------------------------------------------
  // 主流程
  // -------------------------------------------------------------------------

  /**
   * 启动/恢复执行。幂等入口：崩溃恢复时也走这里，
   * 从 store 加载 messages + stepsUsed 从断点继续。
   */
  async start(): Promise<RunStatus> {
    const rec = await this.deps.store.getRun(this.runId);
    if (!rec) throw new Error(`run not found: ${this.runId}`);
    this.record = rec;
    this.messages = await this.deps.store.loadMessages(rec.sessionId);

    // 恢复前置校验：不允许带病重放（recovery.ts 负责事先修补）
    const dangling = findDanglingToolCalls(this.messages);
    if (dangling.size > 0) throw new Error(`非法状态：存在悬空 tool calls ${[...dangling].join(',')}`);

    if (!(await this.deps.store.acquireLease(this.runId, WORKER_ID, LEASE_TTL_MS))) {
      throw new Error(`lease 抢占失败：${this.runId} 可能已被其他 worker 持有`);
    }
    await this.deps.store.transitionRun(this.runId, 'QUEUED', 'RUNNING');

    // lease 心跳：worker 活着的证据，recovery 靠它判定孤儿 run
    this.heartbeat = setInterval(() => {
      void this.deps.store.renewLease(this.runId, WORKER_ID, LEASE_TTL_MS);
    }, HEARTBEAT_MS);

    // 墙钟预算：到点主动 abort，防卡死在慢工具/慢模型上
    if (this.record.budget.deadlineMs) {
      this.deadlineTimer = setTimeout(
        () => this.cancel({ kind: 'TIMEOUT' }),
        Math.max(0, this.record.budget.deadlineMs - Date.now()),
      );
    }

    try {
      await this.loop();
    } finally {
      clearInterval(this.heartbeat);
      clearTimeout(this.deadlineTimer);
    }
    const finalStatus = this.record.status;
    this.settleDone(finalStatus);
    return finalStatus;
  }

  private get signal(): AbortSignal {
    return this.controller.signal;
  }

  private async loop(): Promise<void> {
    while (true) {
      // === 位置 C：轮次边界的取消检查（最干净的取消点）===
      if (this.signal.aborted) return void (await this.finalizeCancelled());

      // === 预算检查：耗尽是暂停不是失败 ===
      if (this.record.stepsUsed >= this.record.budget.maxSteps) {
        return void (await this.suspend('WAITING_USER', 'BUDGET_EXHAUSTED'));
      }

      // === 位置 A：模型调用（abort 可能在流式响应中触发）===
      let assistant: AssistantMessage;
      try {
        assistant = await this.deps.model.complete(this.messages, this.signal);
      } catch (e) {
        if (isAbortError(e, this.signal)) {
          // 半截 assistant 消息在 model.complete 内部已被丢弃（未 push）。
          // messages 尾部仍是上一个完整 checkpoint，无悬空 call，无需修补
          return void (await this.finalizeCancelled());
        }
        return void (await this.fail(e as Error));
      }

      this.messages.push(assistant);
      // 先落库再执行工具：工具副作用成功但消息丢失 = 恢复时模型不知道自己说过什么
      await this.deps.store.appendMessages(this.runId, [assistant]);

      // === 无工具调用 → 本轮任务完成 ===
      if (!assistant.tool_calls?.length) {
        this.record.status = 'COMPLETED';
        await this.deps.store.transitionRun(this.runId, 'RUNNING', 'COMPLETED');
        return;
      }

      // === 逐个执行工具（abort 可能落在任何一个上）===
      let abortedDuringTools = false;
      for (const call of assistant.tool_calls) {
        if (call.type !== 'function') continue;
        const args = JSON.parse(call.function.arguments) as Record<string, unknown>;

        // --- 审批门（位置 D 的挂起点在这里面）---
        if (this.deps.requiresApproval(call.function.name, args)) {
          const decision = await this.requestApproval(call.id, call.function.name, args);
          if (decision.aborted) {
            // abort 解锁 ≠ 人类拒绝：终止 run，当前及后续 call 统一由
            // finalizeCancelled 补齐（含 SKIPPED），不产生"人类拒绝"假象
            abortedDuringTools = true;
            break;
          }
          if (!decision.approved) {
            // 真正的人类拒绝：这是信息，喂回模型让它改口（04-hitl 行为）
            this.messages.push(
              toolResultMessage(call.id, { ok: false, error: `REJECTED_BY_HUMAN: ${decision.reason ?? ''}` }),
            );
            continue;
          }
        }

        // --- 位置 B：工具执行中 abort ---
        try {
          const result = await this.deps.executor.execute(call.function.name, call.id, args, {
            runId: this.runId,
            signal: this.signal, // 必须透传！否则"取消"只取消了 loop，工具还在后台跑
            audit: (ev, d) => this.deps.logger(`[audit] ${ev} ${JSON.stringify(d ?? {})}`),
          });
          this.messages.push(toolResultMessage(call.id, result));
          // 边执行边落库：每完成一个 call 就 append，缩小"已执行未落库"的窗口
          await this.deps.store.appendMessages(this.runId, [this.messages.at(-1)!]);
        } catch (e) {
          if (isAbortError(e, this.signal)) {
            abortedDuringTools = true;
            break; // 跳出 for，先补协议再终态（见 finalizeCancelled）
          }
          // 工具真异常：作为失败结果喂回，loop 继续（模型自己决定重试还是改道）
          const errResult: ToolResult = { ok: false, error: `TOOL_ERROR: ${(e as Error).message}` };
          this.messages.push(toolResultMessage(call.id, errResult));
          await this.deps.store.appendMessages(this.runId, [this.messages.at(-1)!]);
        }
      }

      // === 轮次边界 checkpoint：状态 + 计数原子落库 ===
      this.record.stepsUsed++;
      const r = await this.deps.store.getRun(this.runId);
      if (r) {
        r.stepsUsed = this.record.stepsUsed;
        await this.deps.store.saveRun(r);
      }

      if (abortedDuringTools) return void (await this.finalizeCancelled());

      // 崩溃点自测：任何时候 kill -9，恢复后从 loadMessages 的断点重放
    }
  }

  // -------------------------------------------------------------------------
  // 审批门（04-hitl 的生产化版本）
  // -------------------------------------------------------------------------

  private async requestApproval(callId: string, tool: string, args: Record<string, unknown>): Promise<ApprovalDecision> {
    // 状态先落库再等人：WAITING_APPROVAL 期间崩溃，恢复时仍停在等待态，
    // 审批端卡片不失效（跨进程恢复的关键：状态在 DB 不在内存）
    const payload: ApprovalPayload = { toolCallId: callId, tool, args, summary: `${tool} ${JSON.stringify(args)}` };
    const rec = await this.deps.store.getRun(this.runId);
    if (rec) {
      rec.status = 'WAITING_APPROVAL';
      rec.pendingApproval = payload;
      await this.deps.store.saveRun(rec);
    }
    this.deps.notifyApprovalNeeded(this.runId, payload);

    return new Promise<ApprovalDecision>((resolve) => {
      // 挂起 + 可被 cancel() 解锁。Promise 不泄漏的关键：两条路都 resolve 且只 resolve 一次
      this.pendingApproval = resolve;
      this.signal.addEventListener(
        'abort',
        () => resolve({ approved: false, aborted: true, reason: 'RUN_CANCELLED' }),
        { once: true },
      );
    });
  }

  // -------------------------------------------------------------------------
  // 终态/暂停态收尾
  // -------------------------------------------------------------------------

  /**
   * 取消收尾：按 AbortReason 迁移状态 + 修补消息协议 + 落库。
   * 编译器保证每个 reason 都有分支（新增 reason 忘了处理会编译报错）。
   */
  private async finalizeCancelled(): Promise<void> {
    // 修补协议：所有悬空 call（含"因 abort 而没执行到的"）补配对 tool result。
    // 补的语义分两档：CANCELLED_BY_USER（被掐的那个）/ SKIPPED（没轮到的）。
    // 为什么要落库：preempt 场景新 run 会看到这些标记，模型能理解
    // "上一个动作被打断了"，而不是以为自己没做过
    const dangling = findDanglingToolCalls(this.messages);
    for (const callId of dangling) {
      this.messages.push(toolResultMessage(callId, { ok: false, error: 'CANCELLED_BY_USER' }));
    }
    if (dangling.size > 0) await this.deps.store.appendMessages(this.runId, [...this.messages.slice(-dangling.size)]);

    const reason = (this.signal.reason ?? { kind: 'USER_CANCEL' }) as AbortReason;
    switch (reason.kind) {
      case 'USER_CANCEL':
      case 'PREEMPT':
        this.record.status = 'CANCELLED';
        break;
      case 'TIMEOUT':
        // 超时是预算问题的变体：可恢复的暂停，不是终态
        this.record.status = 'WAITING_USER';
        break;
      case 'SHUTDOWN':
        // 优雅停机：回 QUEUED。重启后 recovery 重新调度，
        // 决不因部署滚动把用户的任务标成 CANCELLED
        this.record.status = 'QUEUED';
        break;
    }
    const rec = await this.deps.store.getRun(this.runId);
    if (rec) {
      rec.status = this.record.status;
      rec.pendingApproval = null;
      await this.deps.store.saveRun(rec);
    }
    this.deps.logger(`[run:${this.runId}] finalize → ${this.record.status} (${reason.kind})`);
  }

  /** 预算耗尽/用户暂停：干净的轮次边界暂停，无需协议修补 */
  private async suspend(status: 'WAITING_USER', reason: string): Promise<void> {
    const rec = await this.deps.store.getRun(this.runId);
    if (rec) {
      rec.status = status;
      await this.deps.store.saveRun(rec);
    }
    this.record.status = status;
    this.deps.logger(`[run:${this.runId}] suspend → ${status} (${reason})`);
  }

  private async fail(e: Error): Promise<void> {
    const rec = await this.deps.store.getRun(this.runId);
    if (rec) {
      rec.status = 'FAILED';
      await this.deps.store.saveRun(rec);
    }
    this.record.status = 'FAILED';
    this.deps.logger(`[run:${this.runId}] FAILED: ${e.message}`);
  }
}

/** 生产中 = 实例 ID（pod name / 容器 ID）。lease 按 worker 隔离 */
const WORKER_ID = `worker-${process.pid}`;
