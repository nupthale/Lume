/**
 * ============================================================
 * tools.ts — Tool 接口与幂等执行器
 * ============================================================
 *
 * 两个生产要求：
 *   1. signal 必须贯穿到工具内部（shell child_process / fetch / http 请求），
 *      否则"取消"只取消了 loop，工具还在后台烧钱/写库
 *   2. 副作用必须幂等：崩溃恢复重放 messages 时，已执行过的工具
 *      靠 idempotency 表去重，绝不第二次退款/发消息
 *
 * 取消发生在工具执行中时最危险（AbortController 三层之一）：
 *   副作用可能已经发生了一半（钱扣了，结果没落库）。
 *   处理策略：幂等记录留在 IN_FLIGHT，禁止自动重试，
 *   转查询型工具核实真实状态（查退款单号）或人工对账。
 */

import type { ToolResult } from './types.js';
import type { IdempotencyStore } from './store.js';
import { idemKey } from './store.js';

// ---------------------------------------------------------------------------
// Tool 契约
// ---------------------------------------------------------------------------

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema

  /**
   * @param signal 取消信号。实现必须透传到底层操作：
   *   - fetch(url, { signal })
   *   - child_process.spawn + tree-kill
   *   - pg 的 query({ signal })（Node 20+ 原生支持）
   * @returns 结构化结果，成功失败都要返回（失败也是信息，喂回模型）
   */
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
}

/** 工具执行上下文：run.ts 的 executeTool 把这些传给幂等包装器 */
export interface ToolExecContext {
  runId: string;
  signal: AbortSignal;
  /** 审计日志钩子：谁、何时、对哪个 call、执行了什么 */
  audit(event: string, detail?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// 幂等执行器：所有工具调用都必须经过这里，禁止直调 tool.execute
// ---------------------------------------------------------------------------

export class ToolExecutor {
  constructor(
    private tools: Map<string, Tool>,
    private idempotency: IdempotencyStore,
  ) {}

  async execute(toolName: string, callId: string, args: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) return { ok: false, error: `unknown tool: ${toolName}` };

    const key = idemKey(ctx.runId, callId);

    // --- 幂等护栏：INSERT-if-absent 语义 ---
    const state = await this.idempotency.tryInsert(key);
    if (state === 'DONE') {
      // 崩溃重放场景：这个 call 之前执行成功过（messages 里 result 可能丢失），
      // 直接复用缓存结果，副作用不重放
      ctx.audit('idempotent_replay', { key });
      return { ok: true, data: await this.idempotency.getResult(key) };
    }
    if (state === 'IN_FLIGHT') {
      // 上一次执行没有走到终态：副作用状态未知（可能是"扣款扣到一半"）。
      // 生产选择：宁可阻塞也不盲目重试 —— 返回错误让模型走查询/人工路径
      ctx.audit('idempotent_conflict', { key });
      return { ok: false, error: 'SIDE_EFFECT_STATE_UNKNOWN: 上次执行被中断，请勿重试，转人工或查询真实状态' };
    }

    // --- FIRST：真正执行 ---
    try {
      const result = await tool.execute(args, ctx.signal);
      if (result.ok) await this.idempotency.markDone(key, result.data);
      // 失败结果不 markDone：干净的业务失败可以安全重试（副作用没发生）
      return result;
    } catch (e) {
      // signal 已触发 → 这是取消中断（三层之一），不是业务失败。
      // IN_FLIGHT 记录【故意保留】：恢复时这个 call 会命中
      // SIDE_EFFECT_STATE_UNKNOWN 分支，而不是静默重执行副作用。
      // 这就是"批准后执行前崩溃"问题的工具侧答案。
      if (ctx.signal.aborted) throw e;
      // 真异常（网络炸了等）：同样保留 IN_FLIGHT，交给上层重试策略
      throw e;
    }
  }
}
