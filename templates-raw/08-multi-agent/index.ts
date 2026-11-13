/**
 * ============================================================
 * 08 — Multi-Agent 并行：fan-out / fan-in（map-reduce）
 * 对照场景: deep-research 的并行检索 / LangGraph 的 map-reduce 模式
 * ============================================================
 *
 * 07 回答了"什么是 multi-agent"，本例回答"什么时候能并行"：
 *
 *   并行的唯一前提：子任务之间没有数据依赖。
 *   07 里预算师要等调研员的价格数字 → 必须串行（依赖是一条链）
 *   08 里三个城市的调研互不依赖     → 可以并行（依赖是一层宽度）
 *   把任务画成 DAG：串行是链，并行是同层。
 *
 * 本例实现 deep-research 类产品最常用的并行形态——fan-out / fan-in：
 *
 *   用户需求（从杭州/苏州/南京选一个周末游目的地）
 *     ↓ ① 拆题：一次 LLM 调用 + tool_choice 强制结构化输出（同 05 的技巧）
 *   3 个互不依赖的子任务
 *     ↓ ② fan-out：Promise.all 并发跑 3 个调研员实例
 *   3 份独立报告
 *     ↓ ③ fan-in：一次 LLM 调用对比汇总，给出最终推荐
 *
 * 两个核心认知：
 *   1. 并行不在 LLM 里，在 harness 里。模型只负责"拆出互不依赖的任务"，
 *      真正同时跑靠的是 Promise.all——LLM API 是无状态请求，天然支持并发
 *      （上限取决于推理服务的吞吐）。
 *   2. 并行不需要 3 份 agent 代码。AgentSpec 是数据：同一个 researcher
 *      定义可以同时跑 N 个实例，每个实例一份独立 messages（同 07 的隔离）。
 *
 * 和 07 怎么选：
 *   - 任务结构跑之前就知道（N 个候选城市 / N 份文档 / N 个审查角度）
 *     → 用本例的代码 fan-out，便宜、快速、确定
 *   - 任务结构要临场决定（先拿到调研数字才能算账）
 *     → 用 07 的 orchestrator LLM 派活
 *   （另一种并行形态：orchestrator 在一条消息里发出多个 tool_call，
 *    执行层对这批 call Promise.all——本质相同："同一批、无依赖 → 并发"。
 *    07 的执行循环逐个 await 是保守写法；串行的理由只能是数据依赖。）
 *
 * 观察点（跑的时候盯着终端）：
 *   - 三个城市的 Step 日志交错出现——并发的直接证据
 *   - fan-out 段耗时 ≈ 最慢的那个子任务，而不是三个之和（结束有统计）
 *
 * 运行: npx tsx 08-multi-agent/index.ts
 */

import OpenAI from 'openai';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

// ---------------------------------------------------------------------------
// 第 0 层：通用 agent runner —— 和 01/07 完全相同的 loop 骨架。
// 唯一值得注意的：它没有任何全局状态，messages 是局部变量——
// 所以同一个 AgentSpec 天然可以被并发调用多次，互不干扰。
// ---------------------------------------------------------------------------

interface AgentSpec {
  name: string;
  systemPrompt: string;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  handlers: Record<string, (args: any) => unknown>;
  maxSteps?: number;
}

function parseArgs(raw: string | undefined): any {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

async function runAgent(spec: AgentSpec, task: string): Promise<string> {
  const messages: Messages = [
    { role: 'system', content: spec.systemPrompt },
    { role: 'user', content: task },
  ];
  const maxSteps = spec.maxSteps ?? 6;

  for (let step = 1; step <= maxSteps; step++) {
    console.log(`── [${spec.name}] Step ${step}/${maxSteps} ──`);
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: spec.tools,
      ...(extraBody ?? {}),
    });
    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      console.log(`── [${spec.name}] 完成 ──`);
      return msg.content ?? '(空回复)';
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      const args = parseArgs(call.function.arguments);
      console.log(`  [${spec.name}] 🔧 ${call.function.name} ${call.function.arguments?.slice(0, 90)}`);
      let result: unknown;
      try {
        const handler = spec.handlers[call.function.name];
        result = handler ? await handler(args) : { error: `unknown tool: ${call.function.name}` };
      } catch (err: any) {
        result = { error: err.message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      console.log(`    ✅ ${JSON.stringify(result).slice(0, 120)}`);
    }
  }

  const final = await client.chat.completions.create({ model: MODEL, messages, ...(extraBody ?? {}) });
  console.log(`── [${spec.name}] 步数预算耗尽，强制收尾 ──`);
  return final.choices[0].message.content ?? '(无结论)';
}

// ---------------------------------------------------------------------------
// 工人：调研员。三个城市并行调研用的是同一份定义——
// 并行不需要三份代码，只需要三个任务（agent 是数据，同 07）
// ---------------------------------------------------------------------------

const TRAVEL_KB: Array<{ id: string; title: string; text: string }> = [
  // 杭州
  { id: 'hz-1', title: '杭州·西湖', text: '杭州西湖景区免费开放，断桥、苏堤步行 2-3 小时；雷峰塔登塔 40 元/人；游船 55 元/人含三潭印月登岛。' },
  { id: 'hz-2', title: '杭州·灵隐寺', text: '杭州灵隐寺·飞来峰门票 45+30=75 元/人，需公众号预约，游览约 3 小时，清晨人少。' },
  { id: 'hz-3', title: '杭州美食', text: '杭州美食：片儿川 25 元/碗、东坡肉 68 元/份、龙井虾仁 128 元/份、知味观人均 70 元、新丰小吃人均 30 元。' },
  { id: 'hz-4', title: '杭州周末天气', text: '杭州本周末天气：周六多云 18-24°C 适合户外；周日小雨概率 60%，16-21°C，需带伞。' },
  // 苏州
  { id: 'sz-1', title: '苏州·拙政园', text: '苏州拙政园门票 70 元/人需预约，游览 2-3 小时，中国四大名园之首，园林历史代表。' },
  { id: 'sz-2', title: '苏州·平江路', text: '苏州平江路历史街区免费，青石板路适合傍晚漫步 2 小时；手摇船 40 元/人；山塘街夜景亦免费。' },
  { id: 'sz-3', title: '苏州美食', text: '苏州美食：苏式汤面 30 元/碗（同得兴）、松鼠桂鱼 128 元/份、哑巴生煎人均 25 元、桂花糕 10 元。' },
  { id: 'sz-4', title: '苏州周末天气', text: '苏州本周末天气：周六晴 19-26°C；周日多云转阴 17-23°C，无雨，均适合户外。' },
  // 南京
  { id: 'nj-1', title: '南京·中山陵', text: '南京中山陵免费但需预约，台阶较多，游览 2-3 小时；注意周一祭堂不开放。' },
  { id: 'nj-2', title: '南京·夫子庙', text: '南京夫子庙街区免费，秦淮河画舫夜游 55 元/人，逛 2 小时；距总统府地铁 20 分钟，总统府门票 35 元。' },
  { id: 'nj-3', title: '南京美食', text: '南京美食：鸭血粉丝汤 25 元/碗、盐水鸭 60 元/只、汤包 20 元/笼、夫子庙小吃人均 50 元。' },
  { id: 'nj-4', title: '南京周末天气', text: '南京本周末天气：周六多云 20-27°C；周日多云 18-24°C，无雨，适合户外。' },
];

/** 子串匹配打分（纯中文没有词边界，整词 token 匹配不上，同 07 的教训） */
function searchKB(query: string) {
  const terms = [...new Set((query.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2))];
  return TRAVEL_KB.map((doc) => {
    const hay = `${doc.title} ${doc.text}`;
    return { doc, score: terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ doc }) => ({ id: doc.id, title: doc.title, text: doc.text }));
}

const researcher: AgentSpec = {
  name: '调研员', // fan-out 时会被覆盖成"杭州调研员"等，日志好认
  systemPrompt:
    '你是旅行调研员。用 search 工具查询指定目的地的景点、美食、天气等信息。' +
    '逐一核对任务要求的每个维度：哪个维度的信息还没查到，就用带该维度词的' +
    '关键词（如"杭州 天气"、"杭州 美食"）再查，直到全部覆盖。最后输出简洁的' +
    '中文要点汇报，每条附关键数字（价格、时长、温度）。search 没返回的信息不要编造。',
  tools: [
    {
      type: 'function',
      function: {
        name: 'search',
        description: '按关键词检索旅行知识库，返回最匹配条目的全文',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '检索关键词，如"苏州 美食"' } },
          required: ['query'],
        },
      },
    },
  ],
  handlers: {
    search: (args: any) => {
      const query = typeof args.query === 'string' && args.query.trim() ? args.query : JSON.stringify(args);
      return searchKB(query);
    },
  },
};

// ---------------------------------------------------------------------------
// ① 拆题（fan-out 的决策点）：一次 LLM 调用 + tool_choice 强制结构化输出。
// 为什么不用 orchestrator LLM 派活（07 那样）？因为"按城市拆"这个结构
// 拆一次就定了，不需要每派一个活就调一次模型——能确定的编排交给代码。
// ---------------------------------------------------------------------------

const SPLIT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'split_tasks',
    description: '提交拆解结果：2-4 个互不依赖、可并行执行的子任务',
    parameters: {
      type: 'object',
      properties: {
        subtasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '子任务短标签（如城市名），用于日志' },
              task: { type: 'string', description: '子任务完整描述，将交给调研员执行' },
            },
            required: ['label', 'task'],
          },
        },
      },
      required: ['subtasks'],
    },
  },
};

async function splitTasks(request: string): Promise<Array<{ label: string; task: string }>> {
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是任务拆解器。把用户的调研需求拆成 2-4 个互不依赖的子任务' +
          '（每个候选目的地一个），子任务描述里写明要调研的维度（景点/美食/天气等），' +
          '每个子任务可以独立交给一个调研员并行执行。',
      },
      { role: 'user', content: request },
    ],
    tools: [SPLIT_TOOL],
    tool_choice: { type: 'function', function: { name: 'split_tasks' } }, // 强制结构化输出（同 05）
    ...(extraBody ?? {}),
  });

  const call = res.choices[0].message.tool_calls?.find((c) => c.type === 'function');
  const args = call ? parseArgs(call.function.arguments) : {};
  const raw = Array.isArray(args.subtasks) ? args.subtasks : [];
  const subtasks = raw
    .filter((t: any) => t && typeof t.task === 'string' && t.task.trim())
    .map((t: any, i: number) => ({ label: String(t.label ?? `子任务${i + 1}`).slice(0, 12), task: t.task.trim() }));

  // 模型输出不合预期时的兜底（harness 不信任模型自觉，同 05/07）
  return subtasks.length ? subtasks.slice(0, 4) : [
    { label: '杭州', task: '调研杭州适合周末游的景点、美食、天气' },
    { label: '苏州', task: '调研苏州适合周末游的景点、美食、天气' },
    { label: '南京', task: '调研南京适合周末游的景点、美食、天气' },
  ];
}

// ---------------------------------------------------------------------------
// ③ 汇总（fan-in）：注意它不是 agent loop，就是一次普通 LLM 调用——
// 没有工具要调就不需要循环。用不用 loop 取决于"要不要工具/多步"，
// 而不是"是不是 multi-agent 系统的一环"。
// ---------------------------------------------------------------------------

async function synthesize(request: string, subtasks: Array<{ label: string }>, reports: string[]): Promise<string> {
  const digest = subtasks.map((s, i) => `## 调研报告：${s.label}\n${reports[i]}`).join('\n\n');
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是汇总师。基于多份独立调研报告做对比分析，输出最终推荐：' +
          '① 对比表格（景点/美食/天气/大致花费）② 明确的首选城市及理由 ' +
          '③ 2 天行程要点。只使用报告里的信息，不要编造。',
      },
      { role: 'user', content: `${request}\n\n${digest}` },
    ],
    ...(extraBody ?? {}),
  });
  return res.choices[0].message.content ?? '(空回复)';
}

// ---------------------------------------------------------------------------
// 演示：拆题 → 并行调研 → 汇总
// ---------------------------------------------------------------------------

async function main() {
  console.log('场景：从杭州/苏州/南京里选一个周末游目的地。\n');
  console.log('流程：① 拆题（fan-out 决策）→ ② Promise.all 并行调研 → ③ 汇总（fan-in）\n');

  const request =
    '我想选一个周末 2 天的出游目的地，候选：杭州、苏州、南京。' +
    '我喜欢历史和美食，预算 800 元，麻烦对比三个城市帮我做决定。';

  const t0 = Date.now();

  // ① 拆题
  const subtasks = await splitTasks(request);
  console.log(`① 拆出 ${subtasks.length} 个互不依赖的子任务（耗时 ${Date.now() - t0}ms）:`);
  subtasks.forEach((s, i) => console.log(`   ${i + 1}. [${s.label}] ${s.task.slice(0, 60)}`));
  console.log('');

  // ② fan-out：本文件的核心。
  //    同一个 researcher 定义 → N 个并发实例 → 每个实例独立的 messages。
  //    换成串行只需要把 Promise.all 换成 for...of await——
  //    但三个城市互不依赖，没有理由等。
  const fanOutStart = Date.now();
  const durations: Array<{ label: string; ms: number }> = [];
  const reports = await Promise.all(
    subtasks.map(async (s) => {
      const start = Date.now();
      console.log(`⏱️ [${s.label}] 调研开始`);
      // ↓ 注意这里：{ ...researcher, name: ... } —— AgentSpec 是数据，
      //   给每个实例换个名字只为了让日志好认
      const report = await runAgent({ ...researcher, name: `${s.label}调研员` }, s.task);
      durations.push({ label: s.label, ms: Date.now() - start });
      console.log(`⏱️ [${s.label}] 调研完成\n`);
      return report;
    }),
  );

  // 并行收益统计：并行耗时 ≈ 最慢子任务，串行耗时 = 之和
  const fanOutWall = Date.now() - fanOutStart;
  const serialSum = durations.reduce((n, d) => n + d.ms, 0);
  console.log('② fan-out 统计:');
  durations.forEach((d) => console.log(`   [${d.label}] ${d.ms}ms`));
  console.log(`   串行总和 ${serialSum}ms vs 并行实际 ${fanOutWall}ms（≈ 最慢子任务，省约 ${Math.max(0, serialSum - fanOutWall)}ms）\n`);

  // ③ fan-in
  console.log('③ fan-in：汇总师对比三份报告');
  const plan = await synthesize(request, subtasks, reports);

  const bar = '═'.repeat(60);
  console.log(`${bar}\n最终推荐:\n${bar}`);
  console.log(plan);
  console.log(`\n（全程 ${Date.now() - t0}ms，其中并行调研段 ${fanOutWall}ms）`);
}

main();
