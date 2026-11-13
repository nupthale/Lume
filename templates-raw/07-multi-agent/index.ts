/**
 * ============================================================
 * 07 — Multi-Agent：把「跑一个 agent loop」本身注册成工具
 * 对照场景: Claude Code 的 Task 工具 / LangGraph Supervisor / CrewAI hierarchical
 * ============================================================
 *
 * 先回答上一例的遗留疑问：06-full-agent 算 multi-agent 吗？
 * —— 不算。它有计划/执行两阶段、工具集切换、上下文压缩，但自始至终：
 *     一个 system prompt（一个人设）+ 一份 messages（一份记忆）+ 一个循环。
 *   那只是"单 agent 分阶段授权"，不是"多个 agent 协作"。
 *
 * 判断一个系统是不是 multi-agent，问三个问题：
 *   1. 有几个人设（system prompt）？   → 06：1 个；07：3 个
 *   2. 有几份记忆（messages 数组）？   → 06：1 份；07：每个角色一份
 *   3. 谁调度谁？                      → 06：代码切换工具集；07：主管调度工人
 *
 * 本例实现最常用的一种拓扑 —— orchestrator-worker（主管-工人）：
 *
 *          ┌────────────────┐
 *          │ 主管 orchestrator │   唯一的工具：delegate（派活）
 *          └───────┬────────┘
 *          ┌───────┴────────┐
 *     ┌────▼─────┐    ┌─────▼────┐
 *     │ 调研员    │    │ 预算师    │   各有专属 prompt、工具、messages
 *     └──────────┘    └──────────┘
 *
 * 核心认知（本文件唯一需要记住的一句话）：
 *   multi-agent 不需要任何新框架、新机制——把「跑一个完整的 agent loop」
 *   注册成一个工具，子 agent 跑完自己的循环、把最终回答作为 tool result
 *   返回给主管。这就是 Claude Code 的 Task 工具、LangGraph Supervisor 的全部原理。
 *
 * 为什么值得拆成多个 agent（而不是像 06 那样给一个 agent 配全部工具）：
 *   1. 上下文隔离：调研员的几十条搜索中间结果留在它自己的 messages 里，
 *      主管的 context 只进最终结论——这是长任务不爆 context 的另一条路
 *      （06 走压缩，07 走隔离，两者可以叠加）
 *   2. 人设专注：小 prompt 各管一摊，比一个大杂烩 prompt 更不容易跑偏
 *   3. 可并行：互不依赖的子任务把执行处换成 Promise.all 即可同时跑
 *   4. 权限/模型隔离：可以给不同工人配不同工具白名单、甚至不同模型
 * 代价也直说：token 成倍、延迟叠加、错误沿链路传播、调试更难定位。
 * 经验法则：单 agent 能解决就别上 multi-agent。
 *
 * 另一种常见拓扑——pipeline（流水线）：流程固定时根本不需要主管 LLM，
 * 代码直接编排就行：
 *   const research = await runAgent(researcher, task);
 *   const budget   = await runAgent(accountant, `根据以下信息核算：${research}`);
 * 便宜、确定、好调试。orchestrator 的价值只在"拆哪些任务、派给谁"本身
 * 需要模型临场判断时才体现。本例选 orchestrator，因为它最能展示"agent 即工具"。
 *
 * 运行: npx tsx 07-multi-agent/index.ts
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
// 第 1 层：通用 agent runner —— 和 01 完全相同的 loop 骨架。
// 唯一的区别：system prompt 和工具不再是写死的，而是作为参数传入。
// 于是「一个 agent」从一段代码变成了可以批量定义的数据——
// 这就是 multi-agent 的地基：runner 是同一个，角色是数据。
// ---------------------------------------------------------------------------

/** 一个 agent 的全部定义：名字 + 人设 + 工具表（schema 与实现一一对应） */
interface AgentSpec {
  name: string;
  systemPrompt: string;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  handlers: Record<string, (args: any) => unknown>;
  maxSteps?: number;
}

/** 模型给的参数是 JSON 字符串，解析失败就当空对象（工具内部自行兜底） */
function parseArgs(raw: string | undefined): any {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

async function runAgent(spec: AgentSpec, task: string): Promise<string> {
  // ⚠️ 注意这行：每个 agent 拿到的是全新的 messages 数组。
  // 子 agent 看不到主管的对话，也看不到其他工人的中间过程——上下文隔离。
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

    // 没有工具调用 → 纯文本就是该 agent 的最终回答，循环结束
    if (!msg.tool_calls?.length) {
      console.log(`── [${spec.name}] 完成（内部对话 ${messages.length} 条消息，主管看不到这些细节）──\n`);
      return msg.content ?? '(空回复)';
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      const args = parseArgs(call.function.arguments);
      console.log(`  [${spec.name}] 🔧 ${call.function.name} ${call.function.arguments?.slice(0, 100)}`);
      let result: unknown;
      try {
        const handler = spec.handlers[call.function.name];
        result = handler ? await handler(args) : { error: `unknown tool: ${call.function.name}` };
      } catch (err: any) {
        result = { error: err.message }; // 失败不抛异常，喂回去让模型自己换路子（同 01/05/06）
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      console.log(`    ✅ ${JSON.stringify(result).slice(0, 160)}`);
    }
  }

  // 步数预算耗尽：不带工具再调一次，强制用文字收尾（终止由 harness 控制，同 05 的哲学）
  const final = await client.chat.completions.create({ model: MODEL, messages, ...(extraBody ?? {}) });
  console.log(`── [${spec.name}] 步数预算耗尽，强制收尾 ──\n`);
  return final.choices[0].message.content ?? '(无结论)';
}

// ---------------------------------------------------------------------------
// 第 2 层：两个工人 —— 各有专属 prompt 和互不重叠的工具
// ---------------------------------------------------------------------------

// —— 工人 A：调研员。工具 = 检索 mock 知识库 ——
const TRAVEL_KB: Array<{ id: string; title: string; text: string }> = [
  { id: 'kb-1', title: '西湖景区', text: '杭州西湖免费开放。断桥、苏堤步行游览约 3 小时；三潭印月船票 55 元/人含登岛；雷峰塔登塔 40 元/人，傍晚看日落最佳。' },
  { id: 'kb-2', title: '灵隐寺·飞来峰', text: '杭州灵隐寺·飞来峰：门票 45 元/人 + 香花券 30 元/人，合计 75 元/人，需提前公众号预约。建议上午 8 点前到，游览约 3 小时。' },
  { id: 'kb-3', title: '清河坊历史街区', text: '杭州清河坊历史街区免费。晚上逛 1-2 小时，小吃集中：定胜糕 10 元、葱包桧 8 元、龙须糖 15 元。距西湖步行约 15 分钟。' },
  { id: 'kb-4', title: '京杭大运河·拱宸桥', text: '杭州京杭大运河·拱宸桥免费。水上巴士 3 元/人从武林门到拱宸桥约 40 分钟；桥西历史直街适合傍晚散步 1 小时。' },
  { id: 'kb-5', title: '杭州美食参考价', text: '杭州美食参考价：片儿川 25 元/碗、东坡肉 68 元/份、龙井虾仁 128 元/份、知味观人均 70 元、新丰小吃人均 30 元。' },
  { id: 'kb-6', title: '本周末杭州天气', text: '本周末杭州天气：周六多云 18-24°C 适合户外；周日小雨概率 60%，气温 16-21°C，需带伞，适合室内或短途安排。' },
  { id: 'kb-7', title: '市内交通', text: '杭州市内交通：地铁单程 2-5 元；西湖景区周末车辆单双号限行，建议地铁+步行；公共自行车前 1 小时免费。' },
];

/**
 * 子串匹配打分。05 用的是整词 token 打分，那里能行是因为语料混着英文
 * （REST/GraphQL 天然按空格切开）；纯中文没有词边界，"门票"整词匹配
 * 不上"飞来峰门票"，所以这里改用子串包含计数——对中文语料更可靠。
 */
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
  name: '调研员',
  systemPrompt:
    '你是旅行调研员。用 search 工具查询目的地的景点、美食、天气、交通等信息，' +
    '一次 search 覆盖不全就换几组不同的关键词多查几次，直到覆盖任务要求的' +
    '全部维度。最后输出简洁的中文要点汇报，每条附带关键数字（价格、时长、' +
    '温度）。search 没返回的信息不要编造。',
  tools: [
    {
      type: 'function',
      function: {
        name: 'search',
        description: '按关键词检索旅行知识库，返回最匹配条目的全文',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '检索关键词，如"西湖 门票"' } },
          required: ['query'],
        },
      },
    },
  ],
  handlers: {
    search: (args: any) => {
      // ⚠️ 工具参数是模型生成的，不可信任（可能传 null），边界处兜底
      const query = typeof args.query === 'string' && args.query.trim() ? args.query : JSON.stringify(args);
      return searchKB(query);
    },
  },
};

// —— 工人 B：预算师。工具 = 计算器 ——
// 安全边界：正则白名单只放行数字和四则运算符（"模型提议，代码否决"，同 06 的命令白名单）
function calculateExpr(args: any) {
  const expr = String(args.expression ?? '').replace(/\s+/g, '');
  if (!expr || !/^[\d+\-*/().]+$/.test(expr)) {
    return { error: '只支持数字和 + - * / ( ) 组成的算式' };
  }
  try {
    return { expression: expr, result: Function(`"use strict"; return (${expr})`)() };
  } catch {
    return { error: `无法计算: ${expr}` };
  }
}

const accountant: AgentSpec = {
  name: '预算师',
  systemPrompt:
    '你是预算师。用 calculate 工具做精确算术，禁止心算。逐项列出费用明细，' +
    '用工具算出总计，并与任务给定的预算上限比较；超支时给出具体的削减建议。',
  tools: [
    {
      type: 'function',
      function: {
        name: 'calculate',
        description: '计算算术表达式，支持 + - * / ( )，例如 "45*2+30*2"',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: '算术表达式' } },
          required: ['expression'],
        },
      },
    },
  ],
  handlers: { calculate: calculateExpr },
};

// ---------------------------------------------------------------------------
// 第 3 层：主管 —— 唯一的工具是 delegate，而 delegate 的实现
// 就是「跑一个子 agent loop」。这一行就是 multi-agent 的全部秘密。
// ---------------------------------------------------------------------------

const WORKERS: Record<string, AgentSpec> = { researcher, accountant };

async function delegate(args: any): Promise<unknown> {
  const name = String(args.agent ?? '');
  const task = String(args.task ?? '').trim();
  const spec = WORKERS[name];
  if (!spec || !task) {
    return { error: `派活失败：agent 必须是 ${Object.keys(WORKERS).join('/')} 之一，task 不能为空` };
  }
  console.log(`\n📤 [主管] 派活给 ${spec.name}: ${task}`);
  // ↓↓↓ 本文件的核心：跑一个全新的 agent loop（全新的 messages）
  //      子 agent 的最终回答作为 tool result 回到主管的 messages 里
  const report = await runAgent(spec, task);
  console.log(`📥 [主管] 收到 ${spec.name} 的报告（只有结论进入主管的 context）\n`);
  return { agent: name, report };
}

const orchestrator: AgentSpec = {
  name: '主管',
  systemPrompt:
    '你是旅行规划主管，负责把用户的旅行需求拆成子任务并通过 delegate 派给工人：\n' +
    '  researcher（调研员）：查景点/美食/天气/交通信息\n' +
    '  accountant（预算师）：核算费用\n' +
    '你不直接查资料、不直接算账。工作要求：\n' +
    '1. 先派 researcher 调研用户需求的全部维度（如景点/美食/天气/交通）\n' +
    '2. 拿到调研结果后，把其中的具体价格数字写进 task 再派给 accountant 核算预算\n' +
    '3. 收齐两份报告后直接输出最终方案（不要再派活）：按天行程 + 费用明细 + 天气提示',
  tools: [
    {
      type: 'function',
      function: {
        name: 'delegate',
        description: '把一个子任务派给指定工人执行，返回其最终报告',
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', enum: ['researcher', 'accountant'], description: '工人代号' },
            task: {
              type: 'string',
              description: '子任务描述：写清背景、需要的信息和期望产出；需要数字输入时把具体数字写进去',
            },
          },
          required: ['agent', 'task'],
        },
      },
    },
  ],
  handlers: { delegate },
  maxSteps: 8,
};

// ---------------------------------------------------------------------------
// 演示：用户只要一个周末杭州游方案；主管拆任务 → 派活 → 收报告 → 汇总
// ---------------------------------------------------------------------------

async function main() {
  console.log('场景：规划周末 2 天杭州游。主管不亲自干活，只拆任务、派活、汇总。\n');

  const request =
    '帮我规划一个周末 2 天的杭州单人游：喜欢历史和美食，总预算 1500 元（含市内交通和餐饮），' +
    '请给出按天行程、费用明细和天气提示。';

  const plan = await runAgent(orchestrator, request);

  const bar = '═'.repeat(60);
  console.log(`${bar}\n最终方案（主管汇总，注意它的 context 里只有两份报告，没有工人的搜索细节）:\n${bar}`);
  console.log(plan);
}

main();
