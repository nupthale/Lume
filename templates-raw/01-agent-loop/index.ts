/**
 * ============================================================
 * 01 — 裸 SDK 实现 Agent Loop
 * 对照场景: templates/weather-agent、templates/template-starter-agent
 * ============================================================
 *
 * 核心认知：所有 agent 框架（Mastra / LangGraph / AgentScope）的核心
 * 都是下面这个 while 循环，没有任何魔法：
 *
 *   while (true) {
 *     1. 组装 context（system + 历史 + 工具定义）
 *     2. 调 LLM API
 *     3. 模型返回 tool call？→ 执行工具，把结果塞回 messages，continue
 *     　 模型返回纯文本？　→ 这就是最终回答，break
 *   }
 *
 * messages 数组就是 agent 的全部状态——没有数据库、没有对象、没有类，
 * 一个 JSON 数组从生到死。理解了这一点，你就理解了所有框架。
 *
 * 运行: npx tsx 01-agent-loop/index.ts
 */

import OpenAI from 'openai';

// 默认指向本地 Xinference 部署的 Qwen3（http://10.56.88.230:9998），可用环境变量覆盖
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local', // 本地服务不校验 key，SDK 要求非空
});
const MODEL = process.env.MODEL ?? 'qwen3';

/**
 * Qwen3 默认开 thinking（回复带 <think> 且非常吃 token），教学示例默认关闭。
 * 设 KEEP_THINKING=1 可开启观察区别。
 * 注意：openai SDK v6 没有 extra_body，未知字段会直接作为请求体顶层属性透传，
 * 所以 chat_template_kwargs 直接放在 create() 参数顶层即可。
 */
const enableThinking = process.env.KEEP_THINKING === '1';
const extraBody = enableThinking ? undefined : { chat_template_kwargs: { enable_thinking: false } };

// ---------------------------------------------------------------------------
// 第一步：定义工具
// 工具 = 「给模型看的 JSON Schema 说明」+「给程序执行的函数实现」
// 这两样东西是分开的：模型只看 schema，永远不执行代码
// ---------------------------------------------------------------------------

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市的当前天气',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名，如"北京"' },
        },
        required: ['city'],
      },
    },
  },
];

/** 工具的真实实现。这里返回 mock 数据，真实场景换成 HTTP 调用 */
function executeGetWeather({ city }: { city: string }) {
  const mock: Record<string, { temp: number; condition: string }> = {
    北京: { temp: 12, condition: '晴' },
    上海: { temp: 18, condition: '多云' },
  };
  return mock[city] ?? { temp: 20, condition: '晴' };
}

/** 工具名 → 实现的分发表。框架里对应 Mastra 的 createTool + agent 的 tools 参数 */
const toolImplementations: Record<string, (args: any) => unknown> = {
  get_weather: executeGetWeather,
};

// ---------------------------------------------------------------------------
// 第二步：agent loop 本体
// ---------------------------------------------------------------------------

async function runAgentTurn(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<string> {
  while (true) {
    // ① 组装 context 并调用模型
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools, // 每一轮都带上工具定义，模型才知道自己有什么可用
      ...(extraBody ?? {}),
    });

    const assistantMessage = response.choices[0].message;

    // ② 关键动作：把模型这条消息追加进 messages。
    //    不追加的话模型下一轮看不到自己调过什么工具，API 会直接报错
    messages.push(assistantMessage);

    // ③ 判断：模型想调工具吗？
    const toolCalls = assistantMessage.tool_calls ?? [];

    if (toolCalls.length === 0) {
      // 没有工具调用 → 模型认为信息够了，这段文本就是最终回答
      return assistantMessage.content ?? '(空回复)';
    }

    // ④ 有工具调用 → 逐个执行，用 role='tool' 消息把结果喂回去
    for (const call of toolCalls) {
      if (call.type !== 'function') continue; // SDK v6 还有 custom 工具类型，这里只处理 function
      console.log(`  🔧 模型调用工具: ${call.function.name}(${call.function.arguments})`);

      const args = JSON.parse(call.function.arguments); // 参数是 JSON 字符串，需要解析
      const impl = toolImplementations[call.function.name];
      const result = impl ? impl(args) : { error: 'unknown tool' };

      // tool 消息必须带上 tool_call_id，指明是哪次调用的结果
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    // ⑤ 循环回去——模型此时能看到工具结果，决定继续调工具还是给出回答
    //    循环最多跑多少轮？这里没有限制，生产代码要加 maxSteps 防死循环
    //    （见 05-harness 的实现）
  }
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

async function main() {
  // messages 数组横跨多次用户输入而存在——这就是"多轮对话"的全部秘密
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: '你是一个天气助手。用户问天气时必须调用工具查询，不要编造。' },
  ];

  console.log('=== 第一轮 ===');
  messages.push({ role: 'user', content: '北京今天天气怎么样？' });
  const reply1 = await runAgentTurn(messages);
  console.log(`🤖 ${reply1}\n`);

  console.log('=== 第二轮（注意模型记得上文，无需重新查天气）===');
  messages.push({ role: 'user', content: '那和上海比，哪个更暖和？' });
  const reply2 = await runAgentTurn(messages);
  console.log(`🤖 ${reply2}\n`);

  console.log('=== 最终 messages 数组（agent 的全部状态）===');
  console.log(
    messages.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n'),
  );
}

main();
