/**
 * ============================================================
 * store.ts — 持久化契约（真相源）
 * ============================================================
 *
 * 生产实现：Postgres。
 *   runs 表            —— RunRecord，状态机迁移用条件 UPDATE（乐观并发）
 *   session_messages 表 —— append-only，一行一条消息（跨 run 持续增长）
 *   idempotency 表     —— 工具副作用去重，唯一约束做互斥
 *
 * 为什么 messages 不用单文档 JSON 数组存（踩过的坑）：
 *   单文档会遇到大小上限、并发覆盖、分页困难。
 *   append-only 行级存储天然支持：崩溃后取尾部重放、多 worker 并发追加、
 *   checkpoint 只是一个"已处理到的水位线"。
 *
 * 本文件给出接口 + 内存参考实现（展示契约语义，不可用于生产）。
 * 关键方法的注释就是该方法的"实现说明书"。
 */

import type { Message, RunId, RunRecord, SessionId, ToolCallId } from './types.js';

// ---------------------------------------------------------------------------
// 契约
// ---------------------------------------------------------------------------

export interface RunStore {
  /** 创建 run（状态 QUEUED） */
  createRun(record: RunRecord): Promise<void>;

  /**
   * 条件状态迁移（核心并发原语）：
   * 仅当当前 status === expect 时更新为 next，返回是否成功。
   * 生产 SQL：UPDATE runs SET status=$next WHERE run_id=$id AND status=$expect
   * 用途举例：
   *   - 审批回调：expect='WAITING_APPROVAL'，防止已 CANCELLED 的 run 被审批唤醒
   *   - lease 抢占：expect='RUNNING'
   * 任何状态迁移都必须走这里，禁止无条件覆盖——否则竞态会写出非法状态序列。
   */
  transitionRun(runId: RunId, expect: string, next: RunRecord['status']): Promise<boolean>;

  /** 整记录读写（含 budget / stepsUsed / lease / pendingApproval） */
  getRun(runId: RunId): Promise<RunRecord | null>;
  saveRun(record: RunRecord): Promise<void>;

  /**
   * 追加消息（append-only，永不 UPDATE/DELETE）。
   * 一次 checkpoint 会追加多条（assistant + 若干 tool result），
   * 生产实现应包在同一事务里，保证崩溃后不会出现"半个 checkpoint"。
   */
  appendMessages(runId: RunId, msgs: Message[]): Promise<void>;

  /**
   * 加载会话消息，从 fromSeq 开始（重放恢复用：跳过 checkpoint 之前的）。
   * seq 是消息的全局单调序号（生产：bigserial 主键）。
   */
  loadMessages(sessionId: SessionId, fromSeq?: number): Promise<Message[]>;

  /** lease：worker 心跳。acquire 失败 = 别的 worker 持有且未过期 */
  acquireLease(runId: RunId, workerId: string, ttlMs: number): Promise<boolean>;
  renewLease(runId: RunId, workerId: string, ttlMs: number): Promise<boolean>;
  /** 扫描 lease 过期但状态仍是 RUNNING/WAITING_* 的 run（崩溃恢复入口） */
  findOrphanedRuns(now: number): Promise<RunRecord[]>;
}

export interface IdempotencyStore {
  /**
   * 幂等互斥（工具副作用的护栏）：
   *   FIRST     —— 我是第一个，可以执行副作用
   *   DONE      —— 该 key 的副作用已完成，直接复用结果（崩溃重放场景）
   *   IN_FLIGHT —— 上一次执行没有走到终态（执行中被 abort / worker 崩溃），
   *                副作用可能发生了也可能没发生，禁止盲目重试，转人工/对账
   * 生产 SQL：INSERT INTO idempotency(key) VALUES ($k) ON CONFLICT DO NOTHING
   *           插入成功 = FIRST；再 SELECT status 判断 DONE / IN_FLIGHT。
   */
  tryInsert(key: string): Promise<'FIRST' | 'DONE' | 'IN_FLIGHT'>;
  markDone(key: string, result: unknown): Promise<void>;
  /** 读取 DONE 状态缓存的执行结果 */
  getResult(key: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// 内存参考实现（展示契约语义；生产替换为 Postgres + 事务）
// ---------------------------------------------------------------------------

export class InMemoryRunStore implements RunStore {
  private runs = new Map<RunId, RunRecord>();
  private messages: { sessionId: SessionId; seq: number; msg: Message }[] = [];

  async createRun(record: RunRecord): Promise<void> {
    this.runs.set(record.runId, { ...record });
  }

  async transitionRun(runId: RunId, expect: string, next: RunRecord['status']): Promise<boolean> {
    const r = this.runs.get(runId);
    if (!r || r.status !== expect) return false;
    r.status = next;
    r.updatedAt = Date.now();
    return true;
  }

  async getRun(runId: RunId): Promise<RunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async saveRun(record: RunRecord): Promise<void> {
    this.runs.set(record.runId, { ...record });
  }

  async appendMessages(runId: RunId, msgs: Message[]): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    for (const msg of msgs) {
      this.messages.push({ sessionId: run.sessionId, seq: this.messages.length, msg });
    }
  }

  async loadMessages(sessionId: SessionId, fromSeq = 0): Promise<Message[]> {
    return this.messages.filter((m) => m.sessionId === sessionId && m.seq >= fromSeq).map((m) => m.msg);
  }

  async acquireLease(runId: RunId, workerId: string, ttlMs: number): Promise<boolean> {
    const r = this.runs.get(runId);
    if (!r) return false;
    const now = Date.now();
    if (r.lease && r.lease.expiresAt > now && r.lease.workerId !== workerId) return false;
    r.lease = { workerId, expiresAt: now + ttlMs };
    return true;
  }

  async renewLease(runId: RunId, workerId: string, ttlMs: number): Promise<boolean> {
    const r = this.runs.get(runId);
    if (!r || !r.lease || r.lease.workerId !== workerId) return false;
    r.lease = { workerId, expiresAt: Date.now() + ttlMs };
    return true;
  }

  async findOrphanedRuns(now: number): Promise<RunRecord[]> {
    return [...this.runs.values()].filter(
      (r) =>
        (r.status === 'RUNNING' || r.status === 'WAITING_APPROVAL' || r.status === 'WAITING_USER') &&
        (!r.lease || r.lease.expiresAt < now),
    );
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private entries = new Map<string, { status: 'IN_FLIGHT' | 'DONE'; result?: unknown }>();

  async tryInsert(key: string): Promise<'FIRST' | 'DONE' | 'IN_FLIGHT'> {
    const e = this.entries.get(key);
    if (!e) {
      this.entries.set(key, { status: 'IN_FLIGHT' });
      return 'FIRST';
    }
    return e.status === 'DONE' ? 'DONE' : 'IN_FLIGHT';
  }

  async markDone(key: string, result: unknown): Promise<void> {
    this.entries.set(key, { status: 'DONE', result });
  }

  async getResult(key: string): Promise<unknown> {
    return this.entries.get(key)?.result;
  }
}

/** 幂等 key 的构造：runId + toolCallId 天然唯一。
 *  tool_call_id 是模型生成的 call 唯一标识，同一 call 重放 N 次只应有一次副作用。 */
export function idemKey(runId: RunId, callId: ToolCallId): string {
  return `${runId}:${callId}`;
}
