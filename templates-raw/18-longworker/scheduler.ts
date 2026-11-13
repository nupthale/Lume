/**
 * ============================================================
 * scheduler.ts — SessionScheduler：排队、打断、互斥、优雅停机
 * ============================================================
 *
 * 为什么 per-session 必须互斥：
 *   会话状态就是 messages 数组，两个 run 并发写同一数组必然错乱。
 *   所以一个 session 同时最多一个 active run，后来的请求要么排队要么打断。
 *
 * 两种冲突策略（Trae 的行为是 preempt）：
 *   queue   —— 新消息进 per-session FIFO，当前 run 跑完再依次开跑。
 *              适合批处理/后台任务型产品。
 *   preempt —— cancel({kind:'PREEMPT'}) 等旧 run 完成取消收尾
 *              （补 tool result + 落库 CANCELLED），再立刻起新 run。
 *              可行的原因：取消收尾保证了 messages 协议合法，
 *              新 run 能看到完整历史 + CANCELLED 标记，模型理解
 *              "上一轮动作被打断了，用户给了新指令"。
 *
 * 优雅停机（SIGTERM / k8s 滚动更新）：
 *   对所有 active run cancel({kind:'SHUTDOWN'})，run 收尾时回到 QUEUED
 *   而不是 CANCELLED。重启后 recovery.ts 把 QUEUED 的 run 重新调度。
 *   用户任务绝不能因为发版而丢——这是长任务系统的底线。
 */

import { randomUUID } from 'node:crypto';
import type { AbortReason, ApprovalDecision, Budget, RunInput, RunId, RunStatus, SessionId } from './types.js';
import type { RunStore } from './store.js';
import { AgentRun, type AgentRunDeps } from './run.js';

interface QueueEntry {
  input: RunInput;
  budget: Budget;
}

export class SessionScheduler {
  /** sessionId → 正在执行的 run */
  private active = new Map<SessionId, AgentRun>();
  /** sessionId → 排队请求（FIFO） */
  private queued = new Map<SessionId, QueueEntry[]>();

  constructor(
    private deps: AgentRunDeps,
    private store: RunStore,
  ) {}

  // -------------------------------------------------------------------------
  // 提交任务
  // -------------------------------------------------------------------------

  async submit(input: RunInput, budget: Budget): Promise<RunId> {
    const { sessionId } = input;
    const current = this.active.get(sessionId);

    if (!current) {
      // 空闲：直接把 user 消息落库并开跑
      return this.startRun(input, budget);
    }

    if (input.onConflict === 'preempt') {
      // 打断：等取消收尾完成（补协议 + 落库），保证新 run 读到的
      // messages 是合法且包含 CANCELLED 标记的
      current.cancel({ kind: 'PREEMPT' });
      await current.done;
      return this.startRun(input, budget);
    }

    // 排队：当前 run 结束后 drainQueue 会依次开跑
    const q = this.queued.get(sessionId) ?? [];
    q.push({ input, budget });
    this.queued.set(sessionId, q);
    const queuedRunId = randomUUID(); // 占位 ID；真实实现里排队记录也应有自己的身份
    void queuedRunId;
    return `queued-behind-${current.runId}`; // 简化：生产应返回可查询的排队凭证
  }

  private async startRun(input: RunInput, budget: Budget): Promise<RunId> {
    const runId = randomUUID();

    // 新 run 的消息基础 = 会话全部历史（含被 preempt 的 run 补齐的取消标记）
    // + 本次新 user 消息。append-only 表让这一切天然成立。
    await this.store.appendMessages(runId, [{ role: 'user', content: input.userMessage }]);
    await this.store.createRun({
      runId,
      sessionId: input.sessionId,
      status: 'QUEUED',
      budget,
      stepsUsed: 0,
      pendingApproval: null,
      lease: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const run = new AgentRun(this.deps, runId);
    this.active.set(input.sessionId, run);
    void run.start().then((status) => this.onRunSettled(input.sessionId, status));
    return runId;
  }

  /** run 到达终态/暂停态后：释放互斥锁 + 开跑队列里的下一个 */
  private async onRunSettled(sessionId: SessionId, status: RunStatus): Promise<void> {
    this.active.delete(sessionId);

    // WAITING_APPROVAL / WAITING_USER 期间 session 保持互斥：
    // 暂停 ≠ 结束，新请求必须走 queue/preempt 语义，不能并行开跑
    if (status === 'WAITING_APPROVAL' || status === 'WAITING_USER') {
      // 注意：active 已删除，但恢复入口（resume/审批回调）会重新注册。
      // 简化处理；生产实现里暂停态的 run 也登记在册，resume 时唤醒
      return;
    }

    const q = this.queued.get(sessionId);
    if (q?.length) {
      const next = q.shift()!;
      await this.startRun(next.input, next.budget);
    }
  }

  // -------------------------------------------------------------------------
  // 恢复入口
  // -------------------------------------------------------------------------

  /**
   * 用户说"继续"：WAITING_USER → 重新入队。
   * 预算可追加——这是"预算耗尽是暂停不是失败"的闭环。
   */
  async resume(runId: RunId, extraBudget?: Partial<Budget>): Promise<boolean> {
    const rec = await this.store.getRun(runId);
    if (!rec || rec.status !== 'WAITING_USER') return false;
    if (this.active.has(rec.sessionId)) return false; // 互斥被占，拒绝（生产可转排队）

    // 条件迁移防竞态：仅当仍是 WAITING_USER 才改 QUEUED
    if (!(await this.store.transitionRun(runId, 'WAITING_USER', 'QUEUED'))) return false;

    // 预算追加：deadline 顺延、步数只增不减——"继续"永远不该让任务倒退
    const merged = await this.store.getRun(runId);
    if (merged && extraBudget) {
      merged.budget = {
        ...merged.budget,
        ...extraBudget,
        maxSteps: Math.max(merged.budget.maxSteps, extraBudget.maxSteps ?? 0),
        deadlineMs: Math.max(merged.budget.deadlineMs ?? Infinity, extraBudget.deadlineMs ?? Infinity),
      };
      await this.store.saveRun(merged);
    }

    const run = new AgentRun(this.deps, runId);
    this.active.set(rec.sessionId, run);
    void run.start().then((status) => this.onRunSettled(rec.sessionId, status));
    return true;
  }

  /** 用户点停止 */
  async cancelRun(runId: RunId, reason: AbortReason): Promise<boolean> {
    const rec = await this.store.getRun(runId);
    if (!rec) return false;
    const run = this.active.get(rec.sessionId);
    if (!run || run.runId !== runId) return false;
    run.cancel(reason);
    await run.done;
    return true;
  }

  /** 审批回调路由到对应 run（单 worker 版：直接方法调用） */
  async handleApproval(runId: RunId, decision: ApprovalDecision): Promise<boolean> {
    const rec = await this.store.getRun(runId);
    if (!rec) return false;
    // 前置校验：run 必须仍在等待这个审批（可能已被取消/超时）
    if (rec.status !== 'WAITING_APPROVAL') return false;
    const run = this.active.get(rec.sessionId);
    if (!run || run.runId !== runId) return false;
    if (!(await this.store.transitionRun(runId, 'WAITING_APPROVAL', 'RUNNING'))) return false;
    run.handleApproval(decision);
    return true;
  }

  // -------------------------------------------------------------------------
  // 优雅停机
  // -------------------------------------------------------------------------

  /**
   * SIGTERM 时调用。cancel + await done 确保：
   *   - 每个消息序列协议合法（无悬空 tool call）
   *   - 状态落回 QUEUED（不是 CANCELLED）
   * 然后 process 才能安全退出。k8s terminationGracePeriod 要配够。
   */
  async gracefulShutdown(): Promise<void> {
    const runs = [...this.active.values()];
    for (const run of runs) run.cancel({ kind: 'SHUTDOWN', graceful: true });
    await Promise.all(runs.map((r) => r.done));
  }
}
