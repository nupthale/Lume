/**
 * ============================================================
 * 04 — Human in the Loop（人工审批）
 * 对照场景: templates/template-customer-refund-agent 的 approval 工作流
 * ============================================================
 *
 * 问题 3a 的回答：agent loop + HITL 怎么结合？
 *
 * 核心：工具执行点就是天然的"暂停点"。
 * 把 executeTool 从同步函数变成"可能要问人"的 async 函数，循环其他部分不变：
 *
 *   while (true) {
 *     调模型
 *     for (toolCall of calls) {
 *       if (需要审批) {
 *         await 等人点头  ← 循环在这里"挂起"
 *       }
 *       执行，喂回结果
 *     }
 *   }
 *
 * 两种工程形态：
 *   1. 同进程等待（本例）：await readline，终端里输入 y/n。
 *      适合 CLI / 内部工具。简单直接。
 *   2. 跨进程恢复（生产主流）：把 messages 数组序列化存库，
 *      循环 return 出去；审批通过后新请求进来，反序列化 messages
 *      从断点继续跑。Mastra workflow 的 suspend/resume 本质就是
 *      对"执行到哪一步 + 当时状态"做事件溯源快照。
 *
 * 本例两种都演示：终端等待为主，暂停时打印出可序列化的状态。
 *
 * 场景：客服退款 agent。查订单（自动）→ 退款（必须审批）。
 *
 * 运行: npx tsx 04-hitl/index.ts
 */

import readline from 'node:readline/promises';
import OpenAI from 'openai';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

// ---------------------------------------------------------------------------
// 工具定义与实现
// ---------------------------------------------------------------------------

/** mock 订单库 */
const ORDERS: Record<string, { item: string; price: number; daysAgo: number }> = {
  '1001': { item: '无线耳机', price: 399, daysAgo: 3 },
  '1002': { item: '机械键盘', price: 899, daysAgo: 45 },
  '1003': { item: '手机壳', price: 39, daysAgo: 1 },
};

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_order',
      description: '查询订单详情',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
    },
  },
  {
    type: 'function',
      function: {
        name: 'process_refund',
        description: '执行退款（敏感操作，需要人工审批）。仅支持 30 天内的订单。',
        parameters: {
          type: 'object',
          properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
          required: ['orderId', 'amount'],
        },
      },
  },
];

/** 敏感操作白名单：在这里面的工具执行前要过人工 */
const APPROVAL_REQUIRED = new Set(['process_refund']);

/** mock 退款执行 */
function doRefund(orderId: string, amount: number) {
  return { success: true, orderId, amount, refundId: `RF-${Date.now()}` };
}

// ---------------------------------------------------------------------------
// 审批门 + agent loop
// ---------------------------------------------------------------------------

async function requestApproval(summary: string): Promise<boolean> {
  console.log(`\n⚠️  ================== 需要人工审批 ==================`);
  console.log(`⚠️  ${summary}`);
  console.log(`⚠️  ======================================================`);

  const answer = (await rl.question('批准吗？(y/n) ')).toLowerCase().trim();

  if (answer === 'y') {
    console.log('✅ 已批准，继续执行 agent loop');
    return true;
  }
  console.log('❌ 已拒绝，把拒绝原因喂回模型，让它改用别的方案');
  return false;
}

async function runAgent(messages: Messages) {
  let step = 0;
  while (true) {
    if (++step > 10) throw new Error('超过最大步数'); // 任何循环都要有预算

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      ...(extraBody ?? {}),
    });
    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      console.log(`\n🤖 ${msg.content}`);
      return;
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      const args = JSON.parse(call.function.arguments);
      console.log(`  🔧 工具调用: ${call.function.name} ${call.function.arguments}`);

      if (APPROVAL_REQUIRED.has(call.function.name)) {
        // === 暂停点 ===
        // 打印可序列化状态：生产系统把 messages 存库后直接 return，
        // 审批回调到达时再 loadState(messages) 从这里继续
        console.log(`    ⏸️  暂停点状态（可直接 JSON.stringify 存库）: messages 共 ${messages.length} 条，待执行 ${call.function.name}`);

        const approved = await requestApproval(
          `操作: ${call.function.name}，参数: ${JSON.stringify(args)}，金额: ¥${args.amount ?? 'N/A'}`,
        );

        if (!approved) {
          // 拒绝也是信息：把"人类说不行及原因"作为 tool result 喂回去，
          // 模型会基于这个改口（比如提出部分退款/优惠券方案）
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: 'REJECTED_BY_HUMAN', reason: '审批人拒绝此次退款' }),
          });
          continue;
        }
      }

      // 正常执行
      const result =
        call.function.name === 'lookup_order'
          ? ORDERS[args.orderId] ?? { error: '订单不存在' }
          : doRefund(args.orderId, args.amount);

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      console.log(`    ✅ 结果: ${JSON.stringify(result)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

async function main() {
  console.log('场景：用户申请退款。查单自动执行，真正退款前会停下来问你。\n');

  const messages: Messages = [
    {
      role: 'system',
      content:
        '你是客服 agent。处理退款时：先查订单；订单超 30 天或用户拒绝审批时，' +
        '礼貌说明并给出替代方案（如优惠券）。不要重复请求被拒绝的退款。',
    },
    { role: 'user', content: '我的订单 1001 耳机有杂音，想退款' },
  ];

  await runAgent(messages);

  console.log('\n--- 再来一个被拒绝的例子（选 n 看模型如何改口）---\n');

  const messages2: Messages = [
    {
      role: 'system',
      content:
        '你是客服 agent。处理退款时：先查订单；订单超 30 天或用户拒绝审批时，' +
        '礼貌说明并给出替代方案（如优惠券）。不要重复请求被拒绝的退款。',
    },
    { role: 'user', content: '订单 1002 键盘我想退货退款' },
  ];

  await runAgent(messages2);

  rl.close();
}

main();
