/**
 * ============================================================
 * 05 — Research Harness（研究型任务的驱动框架）
 * 对照场景: templates/template-deep-search、template-agent-harness
 * ============================================================
 *
 * 问题 3b 的回答：什么是 harness？
 *
 * harness = 套在 agent loop 外面的"驱动与约束层"。agent loop 只回答
 * "下一步做什么"，harness 回答：
 *   - 任务怎么分解（plan）
 *   - 什么时候必须停（步数预算 / 完成信号 / 超时）
 *   - 结果如何验收（强制结构化输出、引用、评分）
 *   - 过程如何观测（每步日志、token 成本累计）
 *
 * deep-search 类产品的通用形态（本例实现）：
 *
 *   plan（生成研究大纲）
 *     ↓
 *   loop { search → read → 反思"信息够了吗" }   ← 步数预算 8 步
 *     ↓
 *   submit_report（强制工具调用 = 结构化最终产物）
 *
 * 两个值得学的 harness 技巧：
 *   1. 用"强制工具调用"拿结构化输出（tool_choice: required），
 *      比让模型自由发挥可靠得多
 *   2. 终止条件永远由 harness 控制，不信任模型的自觉
 *
 * 运行: npx tsx 05-harness/index.ts
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
// Mock 知识库：harness 的 search/read 工具操作它
// （真实 deep-search 会换成 Tavily/Exa API + 网页抓取）
// ---------------------------------------------------------------------------

const CORPUS: Array<{ id: string; title: string; text: string }> = [
  {
    id: 'doc-1',
    title: 'REST API 设计要点',
    text: 'REST 依赖标准 HTTP 方法语义（GET/POST/PUT/DELETE），资源即 URL。优点：语义统一、缓存友好（HTTP 缓存直接可用）、工具生态成熟、学习曲线平缓。缺点：接口容易碎片化，复杂页面需要多次往返请求（N+1 问题），字段冗余（over-fetching）。',
  },
  {
    id: 'doc-2',
    title: 'GraphQL 核心特性',
    text: 'GraphQL 客户端按需声明字段，一次请求聚合多个资源。优点：解决 over/under-fetching、强类型 Schema 带来自动代码生成、前端驱动的接口演进。缺点：HTTP 缓存默认失效（通常 POST 单端点）、服务端实现复杂、查询复杂度需要限制（防嵌套爆炸）、错误处理模型不如 HTTP 状态码直观。',
  },
  {
    id: 'doc-3',
    title: '缓存与性能对比',
    text: 'REST 可直接利用 HTTP 缓存层（CDN、浏览器缓存、代理），对读多写少场景几乎零成本。GraphQL 需要 Apollo Router 等方案做 persisted query 和边缘缓存才能达到类似效果。实测中 REST 列表页的首屏请求数通常多于 GraphQL 聚合请求。',
  },
  {
    id: 'doc-4',
    title: '团队协作与治理',
    text: 'REST 的 OpenAPI 契约适合前后端分工明确、多团队对接的 B2B 场景。GraphQL 的 Schema 演进对快速迭代的前端团队友好，但需要治理机制防止 Schema 膨胀。微服务对外网关层，REST 网关（Kong、Nginx）成熟度高于 GraphQL 网关。',
  },
  {
    id: 'doc-5',
    title: '安全模型差异',
    text: 'REST 安全模型基于 HTTP（CORS、JWT、OAuth2 资源权限），边界清晰。GraphQL 单端点使得授权粒度必须下沉到字段级（field-level auth），实现成本更高；introspection 查询暴露全部 Schema，生产环境常需关闭。',
  },
  {
    id: 'doc-6',
    title: '选型建议',
    text: '经验法则：公开 API、面向第三方、读多写少 → REST；内部产品、多端（App/Web）共享一套 API、数据图关系复杂 → GraphQL。两者也可共存：对外 REST，对内 BFF 层用 GraphQL 聚合。Netflix、GitHub 均是混合策略。',
  },
];

function searchCorpus(query: string) {
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const q = tokens(query);
  return CORPUS.map((doc) => ({
    id: doc.id,
    title: doc.title,
    snippet: doc.text.slice(0, 60) + '...',
    score: [...tokens(`${doc.title} ${doc.text}`)].filter((t) => q.has(t)).length,
  }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search',
      description: '按关键词检索文档，返回标题和摘要',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: '读取文档全文',
      parameters: {
        type: 'object',
        properties: { docId: { type: 'string' } },
        required: ['docId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_report',
      description:
        '提交最终研究报告。当收集到的信息足以回答研究问题时调用，之后不能再继续搜索。' +
        'summary 用中文，citations 引用用到的 docId。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '研究报告正文，markdown' },
          citations: { type: 'array', items: { type: 'string' }, description: '引用的 docId 列表' },
        },
        required: ['summary', 'citations'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Harness 本体：外层驱动 + 预算 + 观测
// ---------------------------------------------------------------------------

const MAX_STEPS = 8; // 步数预算：harness 硬约束，防失控

async function researchHarness(question: string) {
  console.log(`\n🔬 研究问题: ${question}\n`);

  let totalTokens = 0;
  const readDocs = new Set<string>();

  const messages: Messages = [
    {
      role: 'system',
      content:
        `你是一个研究 agent。针对研究问题制定检索计划，通过 search/read 收集证据，` +
        `信息足够后调用 submit_report 提交。优先覆盖不同角度（性能、安全、团队、选型）。`,
    },
    { role: 'user', content: `研究问题：${question}` },
  ];

  // ---- harness 主循环（和 01 的 agent loop 相同的骨架，加了预算和观测）----
  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`── Step ${step}/${MAX_STEPS} (tokens: ${totalTokens}) ──`);

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      ...(extraBody ?? {}),
    });

    totalTokens += response.usage?.total_tokens ?? 0;
    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      // 模型没调工具就直接输出文本 → 研究任务必须走 submit_report，
      // harness 不接受自由文本，打回重做。这就是"harness 控制产物格式"
      console.log('  ⚠️ 模型试图直接输出文本，harness 拒绝并要求结构化提交');
      messages.push({
        role: 'user',
        content: '请调用 submit_report 提交结构化报告。',
      });
      continue;
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      const args = JSON.parse(call.function.arguments);

      // submit_report = 终止信号，由 harness 决定接受并退出
      if (call.function.name === 'submit_report') {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'ok' });
        console.log(`\n✅ 报告提交（step ${step}，总 tokens: ${totalTokens}，读过 ${[...readDocs].join(', ')}）\n`);
        console.log('═'.repeat(60));
        console.log(args.summary);
        console.log('═'.repeat(60));
        console.log(`📚 引用: ${args.citations.join(', ')}`);
        return { summary: args.summary, citations: args.citations, steps: step, totalTokens };
      }

      let result: any;
      if (call.function.name === 'search') {
        // ⚠️ 工具参数是模型生成的，不可信任：字段可能缺失/类型不对（本例实测踩过：
        //    模型偶尔传 {"query": null} 导致崩溃）。边界处必须校验兜底。
        const query = typeof args.query === 'string' && args.query.trim() ? args.query : JSON.stringify(args);
        result = searchCorpus(query);
        console.log(`  🔍 search("${query}") → ${result.map((r: any) => r.id).join(', ') || '无结果'}`);
      } else if (call.function.name === 'read') {
        const docId = typeof args.docId === 'string' ? args.docId : '';
        const doc = CORPUS.find((d) => d.id === docId);
        readDocs.add(docId);
        result = doc ?? { error: 'doc not found' };
        console.log(`  📖 read(${docId}) → ${doc?.title ?? '未找到'}`);
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  // ---- 预算耗尽：harness 强制收敛 ----
  console.log(`\n⏰ 步数预算耗尽，harness 强制要求模型基于已有信息提交报告`);
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      ...messages,
      { role: 'user', content: '步数预算已用完。立即调用 submit_report，基于已收集的信息提交报告。' },
    ],
    tools,
    tool_choice: { type: 'function', function: { name: 'submit_report' } }, // 强制收敛
    ...(extraBody ?? {}),
  });
  const finalCall = response.choices[0].message.tool_calls?.find((c) => c.type === 'function');
  const args = JSON.parse(finalCall!.function.arguments);
  console.log(`\n${args.summary}`);
  return { ...args, steps: MAX_STEPS, totalTokens };
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

researchHarness('REST 和 GraphQL 各自的优缺点是什么？实际项目应该如何选型？');
