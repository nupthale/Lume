/**
 * ============================================================
 * 10 — 流式输出（Streaming）
 * 对照场景: Trae / Claude Code 的打字机效果、SSE 协议
 * ============================================================
 *
 * 回答的问题：流式到底在"流"什么？tool call 怎么流？出错怎么办？
 *
 * 【为什么要流式】
 *   生成 500 token 的回答要 10 秒。非流式 = 用户盯 10 秒空白，
 *   流式 = 首 token 几百毫秒后就开跑。总时长几乎不变，省的是
 *   "感知延迟"。生产对照：服务端用 SSE 把 chunk 转发给浏览器，
 *   ChatGPT 的打字机就是这么来的。
 *
 * 【流式 tool call 是本例重点】
 *   文本可以边到边打，但工具调用不能"执行半个"——参数是 JSON，
 *   分片到达，必须攒齐才能 JSON.parse。协议关键：
 *   chunk.choices[].delta.tool_calls[] 的每个分片带 index：
 *     - 第一个分片带 id + name，后续分片只带 arguments 的一小段
 *     - 模型并行调多个工具时，靠 index 区分参数属于谁
 *   所以累加器按 index 分槽位：acc[index].args += 分片。
 *   "模型想调工具"立刻就能在界面上显示出来，参数慢慢长——
 *   这就是 Trae 界面上工具名先出现、参数逐渐填充的原理。
 *
 * 【两条 Qwen3 / Xinference 实测坑】
 *   ① tool_calls 可能返回空数组而非 null → 用 .length 判断
 *   ② stream_options: { include_usage: true } 不一定支持 →
 *      本例运行时探测一次，不支持就退化为"流式拿不到精确 token 数"
 *
 * 【重试】
 *   瞬时故障（网络抖动 / 429 / 5xx）是常态。指数退避 = 等待 2^n
 *   递增 + 随机抖动（防止全体客户端同步重试的惊群）。
 *   流式的特殊之处：如果已经吐了半截内容才出错，无脑重试会让
 *   用户看到内容重复——生产实现只在"还没吐字"时自动重试。
 *
 * 运行: npx tsx 10-streaming/index.ts
 */

import OpenAI from 'openai';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖（与 01-09 相同）
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
  timeout: 120_000,
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };

type Msgs = OpenAI.Chat.Completions.ChatCompletionMessageParam[];
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;

// ---------------------------------------------------------------------------
// 工具：get_weather（同 01 的 mock）
// ---------------------------------------------------------------------------

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市的当前天气',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市名，如"北京"' } },
        required: ['city'],
      },
    },
  },
];

function executeGetWeather({ city }: { city: string }) {
  const mock: Record<string, { temp: number; condition: string }> = {
    北京: { temp: 12, condition: '晴' },
    上海: { temp: 18, condition: '多云' },
  };
  return mock[city] ?? { temp: 20, condition: '晴' };
}

// ---------------------------------------------------------------------------
// 指数退避 + 抖动
// ---------------------------------------------------------------------------

async function withRetry<T>(label: string, fn: () => Promise<T>, retries = 3, baseMs = 400): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries) throw e;
      const wait = baseMs * 2 ** attempt + Math.random() * 200; // 指数递增 + 抖动
      console.log(`  ⚠️ [${label}] 第 ${attempt + 1} 次失败（${(e as Error).message.slice(0, 60)}），${Math.round(wait)}ms 后重试`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ---------------------------------------------------------------------------
// 流式调用封装：include_usage 探测（坑 ②）+ 重试
// ---------------------------------------------------------------------------

/** null = 还没探测；探测失败就永远不用 stream_options */
let usageSupported: boolean | null = null;

async function createStream(messages: Msgs, withTools: boolean): Promise<AsyncIterable<Chunk>> {
  const body: Record<string, unknown> = { model: MODEL, messages, stream: true, ...(extraBody ?? {}) };
  if (withTools) body.tools = tools;
  const attempt = (withUsage: boolean) =>
    client.chat.completions.create({
      ...(body as object),
      ...(withUsage ? { stream_options: { include_usage: true } } : {}),
    } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

  return withRetry('create', async () => {
    if (usageSupported === null) {
      try {
        const s = await attempt(true);
        usageSupported = true;
        return s;
      } catch {
        usageSupported = false;
        console.log('  ℹ️ 服务端不支持 stream_options.include_usage —— 流式拿不到精确 token 数（回退后继续）');
      }
    }
    return attempt(false);
  });
}

// ---------------------------------------------------------------------------
// 流式一轮：文本边到边打 + tool call 分片按 index 累积
// ---------------------------------------------------------------------------

interface ToolAcc {
  id: string;
  name: string;
  args: string;
}

async function streamTurn(messages: Msgs, label: string, withTools: boolean) {
  const t0 = Date.now();
  let ttft: number | null = null;
  let text = '';
  let finishReason: string | null = null;
  let usage: Chunk['usage'] | undefined;
  const acc: ToolAcc[] = []; // 下标 = 协议里的 index，天然分槽位

  const stream = await createStream(messages, withTools);
  console.log(`\n--------- ${label} ---------`);
  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage; // 支持 include_usage 时最后一个 chunk 才有
    const choice = chunk.choices[0];
    if (!choice) continue; // usage-only chunk 的 choices 是空数组
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta;
    if (delta?.content) {
      if (ttft === null) {
        ttft = Date.now() - t0;
        console.log(`⏱ 首字延迟 ${ttft}ms —— 用户此刻就开始看到内容`);
      }
      text += delta.content;
      process.stdout.write(delta.content);
    }

    // ---- tool call 分片累积（坑 ②：可能是空数组）----
    for (const tc of delta?.tool_calls ?? []) {
      const i = tc.index ?? 0;
      const slot = acc[i] ?? (acc[i] = { id: '', name: '', args: '' });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name; // name 也可能分片，拼接无害
      if (tc.function?.arguments) {
        slot.args += tc.function.arguments;
        console.log(`  ◂ args 分片: "${tc.function.arguments}"（已累积 ${slot.args.length} 字符）`);
      }
    }
  }
  if (text) console.log('\n');

  const totalMs = Date.now() - t0;
  const tokens = usage ? `${usage.prompt_tokens}+${usage.completion_tokens}` : '（该服务流式不返回 usage）';
  console.log(`⏱ 本轮总耗时 ${totalMs}ms，tokens ${tokens}，finish_reason=${finishReason ?? '-'}`);
  return { text, toolCalls: acc, totalMs };
}

// ---------------------------------------------------------------------------
// 流式 agent loop：攒齐参数才执行；JSON 坏了把错误喂回模型（而不是崩）
// ---------------------------------------------------------------------------

async function streamingAgent(messages: Msgs): Promise<string> {
  for (let step = 0; step < 4; step++) {
    const r = await streamTurn(messages, `第 ${step + 1} 轮流式响应`, true);

    // 坑 ①：Qwen3 的 tool_calls 可能是空数组而非 null
    if (r.toolCalls.length === 0) return r.text || '(空回复)';

    // 流式没有现成的 message 对象——assistant 消息要自己重建后才能入 messages
    messages.push({
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls.map((t, i) => ({
        id: t.id || `call_${i}`, // 个别后端分片不带 id，兜底保证 tool 消息能配对
        type: 'function' as const,
        function: { name: t.name, arguments: t.args },
      })),
    });

    for (const [i, call] of r.toolCalls.entries()) {
      const callId = call.id || `call_${i}`;
      console.log(`🔧 参数攒齐 → JSON.parse → 执行 ${call.name}(${call.args})`);
      let result: unknown;
      try {
        const args = JSON.parse(call.args);
        result = call.name === 'get_weather' ? executeGetWeather(args) : { error: `unknown tool: ${call.name}` };
      } catch (e) {
        // 容错：参数 JSON 坏了不是崩溃点——把错误作为 tool 结果喂回去，模型会自己修
        console.log(`  ⚠️ JSON.parse 失败（${(e as Error).message}）——把错误喂回模型让它重试`);
        result = { error: `参数解析失败: ${(e as Error).message}`, raw_arguments: call.args };
      }
      messages.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify(result) });
    }
  }
  return '(达到最大步数)';
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

async function main() {
  // ===== 第 0 幕：指数退避时序（前两次喂模拟故障）=====
  console.log('========= 第 0 幕：指数退避 + 抖动 =========');
  let flaky = 0;
  await withRetry('退避演示', async () => {
    if (++flaky <= 2) throw new Error('模拟瞬时错误: connection reset by peer');
    console.log('  ✓ 第 3 次尝试成功 —— 生产里把真实 create() 包进这个壳就是效果');
    return true;
  });

  // ===== 第 1 幕：非流式 vs 流式，感知延迟差在哪 =====
  console.log('\n========= 第 1 幕：非流式 vs 流式 =========');
  const q = '用 80 字介绍 HTTP 协议的发展史。';

  const t0 = Date.now();
  const nonStream = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: q }],
    max_tokens: 400,
    ...(extraBody ?? {}),
  });
  console.log(`【非流式】等了 ${Date.now() - t0}ms 才一次性拿到全部内容：`);
  console.log(`  ${nonStream.choices[0].message.content?.trim().slice(0, 60)}…`);

  console.log('【流式】内容随到随打：');
  await streamTurn([{ role: 'user', content: q }], '流式文本', false);
  console.log('结论：总时长同量级，差的是"多久看到第一个字"——流式优化感知延迟，不省算力。');

  // ===== 第 2 幕：流式 tool call —— 分片到达 → 累积 → 攒齐执行 =====
  console.log('\n========= 第 2 幕：流式 agent（工具参数边流边长）=========');
  const messages: Msgs = [
    { role: 'system', content: '你是天气助手。用户问天气必须调用工具查询，禁止编造。' },
  ];
  messages.push({ role: 'user', content: '北京今天天气怎么样？适合穿什么？' });
  const answer = await streamingAgent(messages);
  console.log(`\n🤖 最终回答：${answer}`);

  console.log('\n========= 最终 messages（注意 assistant 的 tool_calls 是我们重建的）=========');
  console.log(
    messages
      .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 50) : JSON.stringify(m.content ?? m).slice(0, 80)}`)
      .map((l) => `  ${l}`)
      .join('\n'),
  );
  console.log(
    '\n生产对照：\n' +
      '  - 服务端把 chunk 通过 SSE 转发给前端，前端按本例同样的 index 累积渲染；\n' +
      '  - 中途断流只在"还没吐字"时自动重试，吐过字就整段重来，否则内容会重复。',
  );
}

main();
