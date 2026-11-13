/**
 * ============================================================
 * Vercel AI SDK 01 — 最简 Hello World（连接自建 OpenAI 兼容服务）
 * 对照场景: templates-raw/01-agent-loop（裸 OpenAI SDK 的等价配置）
 *
 * 运行: npx tsx 01-basic/index.ts
 * ============================================================
 *
 * 配置对照表（OpenAI SDK → Vercel AI SDK）：
 *
 *   // 裸 OpenAI SDK                         // Vercel AI SDK
 *   const client = new OpenAI({             const provider = createOpenAICompatible({
 *     baseURL: 'http://.../v1',        →      name: 'xinference',
 *     apiKey: 'local',                         baseURL: 'http://.../v1',
 *   })                                        apiKey: 'local',
 *                                           })
 *
 *   client.chat.completions.create({         generateText({
 *     model: 'qwen3',                   →      model: provider('qwen3'),
 *     messages: [{role:'system'...},            instructions: '...',   // ← v7 起
 *                {role:'user'...}],             messages: [{role:'user'...}]
 *   })                                        })
 *
 * 核心认知：
 * 1. AI SDK 把「连哪家服务」(provider) 和「怎么调用」(generateText/streamText)
 *    解耦了。任何 OpenAI 兼容服务（Xinference / vLLM / Ollama）都用
 *    @ai-sdk/openai-compatible 接入，换服务商只换 provider，业务代码不动。
 * 2. 模型不再在请求时传字符串，而是先拿到一个 model 实例（可像普通值一样传递）。
 * 3. v7 起不再允许在 messages 里放 role:'system'（会直接报错），
 *    系统提示词改用顶层 instructions 选项，provider 组装请求时会自动放回 system 位。
 * 4. generateText 一次性返回完整文本；要流式输出把 generateText 换成
 *    streamText 即可，参数完全相同。
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖
const provider = createOpenAICompatible({
  name: 'xinference', // 自定义 provider 名，同时也是下方 providerOptions 的 key
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local', // 本地服务不校验 key，SDK 要求非空
});
const MODEL = process.env.MODEL ?? 'qwen3';

const result = await generateText({
  model: provider(MODEL), // 等价于裸 SDK create() 时传 model: 'qwen3'
  // v7 起 system 提示词走 instructions，不再作为消息放进 messages
  instructions: '你是一个简洁的助手，回答控制在两句话以内。',
  messages: [{ role: 'user', content: '用一句话介绍什么是 agent' }],
  // Qwen3 默认开 thinking（回复带 ⅰ6 且非常吃 token），这里显式关闭。
  // 对照裸 SDK 的 extraBody 透传：providerOptions[name] 下的未知字段
  // 会被合并进请求体顶层，所以 chat_template_kwargs 能原样到达 Xinference。
  // 设 KEEP_THINKING=1 可开启观察区别。
  ...(process.env.KEEP_THINKING === '1'
    ? {}
    : {
        providerOptions: {
          xinference: { chat_template_kwargs: { enable_thinking: false } },
        },
      }),
});

console.log(`🤖 ${result.text}\n`);
console.log('--- 元信息（SDK 已把 usage 解析成结构化对象）---');
console.log(`输入 ${result.usage.inputTokens} tokens，输出 ${result.usage.outputTokens} tokens`);
