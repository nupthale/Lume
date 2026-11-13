/**
 * ============================================================
 * index.ts — 组装与用法（骨架示例，不含可运行的 main）
 * ============================================================
 *
 * 依赖注入组装顺序：
 *   Store（真相源）→ ToolExecutor（幂等）→ ModelClient（LLM）
 *   → AgentRunDeps → SessionScheduler → recoverOnBoot → HTTP 接线
 *
 * 外部接入点（生产中各自独立部署/实现）：
 *   - PostgresRunStore / PgIdempotencyStore（替换内存版）
 *   - OpenAIModelClient：流式聚合 + signal 透传（见下方示意）
 *   - 审批端：notifyApprovalNeeded 推卡片，审批回调走
 *     scheduler.handleApproval（04-hitl/web.ts 的 SSE+POST 通道原样适用）
 *   - 优雅停机：process.on('SIGTERM') → scheduler.gracefulShutdown()
 */

import OpenAI from 'openai';
import type { AssistantMessage, Message, ToolResult } from './types.js';
import { InMemoryIdempotencyStore, InMemoryRunStore } from './store.js';
import { ToolExecutor, type Tool } from './tools.js';
import { SessionScheduler } from './scheduler.js';
import { recoverOnBoot } from './recovery.js';
import type { AgentRunDeps, ModelClient } from './run.js';

// ---------------------------------------------------------------------------
// ModelClient 的生产实现示意（流式聚合 + 三层取消的位置 A）
// ---------------------------------------------------------------------------

class OpenAIModelClient implements ModelClient {
  constructor(
    private client: OpenAI,
    private model: string,
  ) {}

  async complete(messages: Message[], signal: AbortSignal): Promise<AssistantMessage> {
    // signal 放第二参数 options 里 —— SDK 层的取消接线。
    // abort 触发时 fetch 底层断开，SDK 抛 APIUserAbortError
    const stream = await this.client.chat.completions.create(
      { model: this.model, messages, stream: true },
      { signal },
    );

    // 流式聚合：content/tool_calls 逐 delta 拼装在【局部变量】里。
    // abort 发生在任何时刻，这个半成品都不会进入调用方——
    // catch 里直接向上抛，run.ts 据此知道"assistant 消息不可信，丢弃"
    let content = '';
    const toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] = [];
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) content += delta.content;
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          toolCalls[tc.index ?? 0] ??= { id: tc.id ?? '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.function?.name) toolCalls[tc.index ?? 0].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[tc.index ?? 0].function.arguments += tc.function.arguments;
        }
      }
    }
    return {
      role: 'assistant',
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    } as AssistantMessage;
  }
}

// ---------------------------------------------------------------------------
// 工具示例：signal 透传 + 幂等由 ToolExecutor 统一保证
// ---------------------------------------------------------------------------

const lookupOrder: Tool = {
  name: 'lookup_order',
  description: '查询订单详情',
  parameters: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
  async execute(args): Promise<ToolResult> {
    // 读操作天然幂等，但仍走 ToolExecutor 统一路径（含 IN_FLIGHT 去重逻辑）
    return { ok: true, data: { orderId: args.orderId, item: '无线耳机', price: 399 } };
  },
};

const processRefund: Tool = {
  name: 'process_refund',
  description: '执行退款（敏感操作，需要人工审批）',
  parameters: {
    type: 'object',
    properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
    required: ['orderId', 'amount'],
  },
  async execute(args, signal): Promise<ToolResult> {
    // 危险副作用：真实实现里这里是支付网关调用，必须
    //   1. fetch(url, { signal }) 或等价物——否则取消后还在扣钱
    //   2. 携带服务端幂等号（ToolExecutor 的 idemKey 或网关单号），
    //      与本地 idempotency 表构成双保险
    void signal;
    return { ok: true, data: { success: true, orderId: args.orderId, amount: args.amount } };
  },
};

// ---------------------------------------------------------------------------
// 组装
// ---------------------------------------------------------------------------

export async function buildScheduler(): Promise<SessionScheduler> {
  // 生产：new PgRunStore(pool), new PgIdempotencyStore(pool)
  const runStore = new InMemoryRunStore();
  const idempotency = new InMemoryIdempotencyStore();

  const model = new OpenAIModelClient(
    new OpenAI({
      baseURL: process.env.OPENAI_BASE_URL ?? 'http://localhost:9998/v1',
      apiKey: process.env.OPENAI_API_KEY ?? 'local',
    }),
    process.env.MODEL ?? 'qwen3',
  );

  const deps: AgentRunDeps = {
    model,
    store: runStore,
    executor: new ToolExecutor(
      new Map([
        [lookupOrder.name, lookupOrder],
        [processRefund.name, processRefund],
      ]),
      idempotency,
    ),
    // 审批门：04-hitl 的 APPROVAL_REQUIRED 白名单
    requiresApproval: (toolName) => toolName === 'process_refund',
    // 生产：推送到审批端（SSE / WebSocket / 飞书卡片），
    // 04-hitl/web.ts 的 push({type:'approval_request'}) 就是这个钩子
    notifyApprovalNeeded: (runId, payload) => console.log(`[approval] ${runId} ${payload.summary}`),
    logger: (line) => console.log(line),
  };

  const scheduler = new SessionScheduler(deps, runStore);

  // 启动恢复：崩溃遗留的 run 修补后重新入队 / 保持等待态
  const report = await recoverOnBoot(runStore);
  console.log(
    `[recovery] 扫描 ${report.scanned} 个孤儿 run：` +
      `重新入队 ${report.requeued.length}，保持等待 ${report.keptWaiting.length}，修补消息 ${report.patched} 条`,
  );

  return scheduler;
}

// ---------------------------------------------------------------------------
// 用法序列（接线示例，不执行）
// ---------------------------------------------------------------------------

/*
const scheduler = await buildScheduler();

// 1. 普通提交
const runId = await scheduler.submit(
  { sessionId: 's-user-42', userMessage: '订单 1001 想退款', onConflict: 'queue' },
  { maxSteps: 10, deadlineMs: Date.now() + 5 * 60_000 },
);

// 2. 用户在 run 进行中发新消息 → 打断旧任务（Trae 形态）
await scheduler.submit(
  { sessionId: 's-user-42', userMessage: '算了，改退货', onConflict: 'preempt' },
  { maxSteps: 10 },
);

// 3. 用户点停止
await scheduler.cancelRun(runId, { kind: 'USER_CANCEL', requestedBy: 'user-42' });

// 4. 审批回调（前端 confirm block 的 POST /approve 打到这里）
await scheduler.handleApproval(runId, { approved: true });

// 5. 预算耗尽后用户说"继续"
await scheduler.resume(runId, { maxSteps: 20 });

// 6. 优雅停机（k8s preStop hook / SIGTERM）
process.on('SIGTERM', () => void scheduler.gracefulShutdown());
*/
