/**
 * ============================================================
 * 12 — RAG（检索增强生成）· 生产级检索管道版
 * 对照场景: company-knowledge 模板、一切"问企业文档"的机器人
 * ============================================================
 *
 * 回答的问题：模型不知道你公司的私有知识，怎么让它"看着文档回答"，
 * 并且能核实它有没有瞎编？
 *
 * 两条路线的根本对比：
 *   微调：把知识"烧进"权重 —— 贵、慢、更新一次重训一次，还会降记忆力
 *   RAG ：把知识放外面，回答前"查出来塞进上下文" —— 便宜、即时生效、
 *         引用可核验。知识频繁更新的场景（政策、价格、文档）RAG 几乎必胜。
 *
 * 朴素版 RAG（一段切块 + 两路加权 0.7/0.3 + 直取 top-4）到生产差在哪？
 * 本例把每一层补齐，每层都标注"朴素版怎么做 / 生产为什么要换"：
 *
 *   ⓪ 查询改写 rewrite：多轮对话里的"那它能删除吗？"必须先还原成
 *      "审计日志能否删除？"才能检索——代词和省略对两路检索都是噪声。
 *      朴素版没有这一层：单轮问答看不出来，多轮立刻翻车。
 *   ① 切块 chunk：一段一块（不变）。生产：结构感知 + 200-500 token
 *      + 相邻 overlap，防止答案骑在切块边界上被切断。
 *   ② 索引 index：向量嵌一次存起来；BM25 统计（df/平均长度）同样
 *      写入时算一次。生产对照：向量库 + 倒排索引（ES），demo 内存版。
 *   ③ 召回 recall：两路各自取 top-50（宁多勿漏），不再一步到位：
 *        向量路（语义）：全量 cosine——生产 = 向量库 ANN 索引（HNSW/IVF）
 *        关键词路（字面）：BM25（IDF 加权 + 词频饱和 + 长度归一）。
 *            朴素版的"命中 token 占比"让 "429" 和 "什么" 同权重；
 *            BM25 里 "429"（全库仅 1 处）的 IDF 权重是常见字的数倍
 *   ④ 融合 fuse：RRF（按名次倒数求和），替代朴素版的 0.7*vec+0.3*kw。
 *      两路分数的尺度根本不可比：embedding 余弦挤在窄带里（不相关对
 *      也常 0.5+），(cos+1)/2 后普遍 0.75-0.95，BM25 却多在 0-3——
 *      名义 0.7/0.3，实际有效权重约 9:1。RRF 只看名次，免疫尺度问题。
 *   ⑤ 精排 rerank + 阈值：漏斗 50 → RRF 取 10 → 逐对打分 → top-4。
 *      打分器缺省用主模型逐对打分（LLM rerank，零基础设施的生产兜底），
 *      设 RERANK_MODEL 走专用 cross-encoder（/v1/rerank，便宜一个量级）。
 *      同时按阈值丢弃不相关候选——检索层就该敢说"没有"，而朴素版
 *      永远硬塞 4 个 chunk，把"识别不相关"的压力全丢给生成模型。
 *   ⑥ 生成 generate + 引用校验 verify：top-k 编号成 [1]..[k] 注入
 *      system prompt，要求句尾标注引用；回答里的 [n] 抽出来校验
 *      编号真实存在（引用幻觉检测的雏形，生产再进一步：NLI 判断
 *      被引句是否真的支持陈述）。
 *   ⑦ 评测 eval：golden 集 + recall@4 / MRR。检索质量先变成数字，
 *      调参（阈值/召回深度/要不要 rerank）才有依据——对照 11 例的
 *      评测框架，工业界针对 RAG 的完整版叫 RAGAS。
 *
 * 本例的"幻觉对照"：同一个私有知识问题问两遍——
 *   裸答（不检索）：模型没有公司知识，数字要么编、要么碰运气——
 *                  关键不是"编错了"，是"对错无法验证"
 *   RAG 答（检索）：数字来自 chunk，句尾有 [n] 可以点回去核对
 *
 * 运行: npx tsx 12-rag/index.ts
 * 可选: NO_EMBED=1    退化为纯 BM25（对照语义路的价值）
 *       NO_REWRITE=1  跳过查询改写（对照改写的价值）
 *       NO_RERANK=1   跳过精排（对照精排的价值：RRF 序直取 top-k，无阈值可用）
 *       RERANK_MODEL  专用 reranker（走 /v1/rerank，如 Qwen3-Reranker-8B）
 *       RERANK_MIN    精排归一阈值（0-1），默认 0.5
 *       EMBED_MODEL   默认 Qwen3-Embedding-8B（与 03 相同）
 */

import OpenAI from 'openai';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖（与 01-11 相同）
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
  timeout: 120_000,
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };
/** 检索用的 embedding 模型；设 NO_EMBED=1 退回纯 BM25（与 03 相同的惯例） */
const EMBED_MODEL = process.env.NO_EMBED === '1' ? undefined : (process.env.EMBED_MODEL ?? 'Qwen3-Embedding-8B');
/** 专用 reranker（Xinference 等 /v1/rerank 兼容服务）；缺省用主模型逐对打分兜底 */
const RERANK_MODEL = process.env.RERANK_MODEL;
/** 精排归一阈值：低于它的候选直接丢弃（检索层拒答的闸门） */
const RERANK_MIN = process.env.RERANK_MIN !== undefined && !Number.isNaN(Number(process.env.RERANK_MIN)) ? Number(process.env.RERANK_MIN) : 0.5;

type ChatMsg = { role: 'user' | 'assistant'; content: string };

// ---------------------------------------------------------------------------
// 语料：三篇虚构的公司政策文档（段落即结构，别小看它——生产切块的
// 第一步永远是"吃掉标题/列表/表格的结构"，本例按段落切是最朴素的版本）
// ---------------------------------------------------------------------------

const DOCS: Array<{ title: string; text: string }> = [
  {
    title: '退款政策',
    text: [
      '单笔订单退款金额上限为 5000 元，超出部分需走人工审批通道。',
      '客户须在收货后 30 天内发起退款申请，逾期系统自动关闭入口。',
      '虚拟商品（会员、点数）支持购后 7 天内无理由退款，仅限未使用部分。',
      '退款将在审核通过后 3 个工作日内原路退回，节假日顺延。',
      '以下情形不予退款：已激活的序列号、定制类商品、已下载的数字内容。',
    ].join('\n'),
  },
  {
    title: 'API 限流规则',
    text: [
      '免费档调用上限为每分钟 60 次请求，专业档为每分钟 600 次。',
      '超过速率限制时服务端返回状态码 429，响应头包含 Retry-After 字段。',
      '持续超限的账户会被临时降级：请求进入排队队列，优先级低于正常流量。',
      '降级不会中断服务，但延迟会显著上升，持续 15 分钟无超限后自动恢复。',
      '突发流量有 2 倍的瞬时余量（burst bucket），仅在峰值时短暂可用。',
    ].join('\n'),
  },
  {
    title: '数据安全政策',
    text: [
      '所有传输链路强制 TLS 1.2 以上，静态数据使用 AES-256 加密存储。',
      '用户请求日志保留 90 天，期满自动删除，删除操作不可恢复。',
      '审计日志保留 180 天，包含所有管理端操作，只读不可篡改。',
      '客户可提交数据删除请求，我们承诺 7 个工作日内完成处理。',
      '生产环境严禁导出真实用户数据，调试必须使用脱敏数据集。',
    ].join('\n'),
  },
];

// ---------------------------------------------------------------------------
// ① 切块：一段一块（demo 语料正好一句一段）。
// 生产是"结构感知 + 定长 + overlap"：按标题层级切、每块 200-500 token、
// 相邻块重叠几十 token，防止答案正好骑在切块边界上被切断。
// ---------------------------------------------------------------------------

interface Chunk {
  id: number;
  docTitle: string;
  text: string;
  vec?: number[];
}

function chunkDocs(): Chunk[] {
  const chunks: Chunk[] = [];
  let id = 1;
  for (const doc of DOCS) {
    for (const para of doc.text.split('\n')) {
      if (para.trim()) chunks.push({ id: id++, docTitle: doc.title, text: para.trim() });
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// ② 索引·向量侧：批量 embed 入库（与 03 相同的 embed 用法）
// ---------------------------------------------------------------------------

async function embed(texts: string[]): Promise<number[][]> {
  // encoding_format 必须显式传 'float'（本服务真实踩过的坑）：
  // openai SDK v6 默认发 base64 并自行解码，而 Xinference 不支持 base64、
  // 照样返回 float 数组 → SDK 把它当 base64 解出全零向量 → norm=0 →
  // cosine 全 NaN，检索静默失效。显式 float 才拿到真实向量。
  const r = await client.embeddings.create({ model: EMBED_MODEL!, input: texts, encoding_format: 'float' });
  return r.data.map((d) => d.embedding);
}

async function buildIndex(chunks: Chunk[]) {
  if (!EMBED_MODEL) {
    console.log(`向量索引：跳过（纯 BM25 模式）`);
    return;
  }
  const vectors = await embed(chunks.map((c) => c.text));
  chunks.forEach((c, i) => (c.vec = vectors[i]));
  console.log(`向量索引：${chunks.length} 个 chunk 全部向量化完成（写入时算一次，检索时复用）`);
}

// ---------------------------------------------------------------------------
// ② 索引·关键词侧：BM25 统计。df（词出现在几个 chunk）、平均长度——
// 和向量一样是"写入时算一次"的索引结构，检索时只查表。
// 生产对照：倒排索引（Elasticsearch/Lucene），这里用内存 Map 近似。
// ---------------------------------------------------------------------------

/** 分词：中文按单字、英文数字按整词（"429" 整体命中）。中文没有空格，词级分词要上分词库（jieba/IK），demo 用单字近似 */
const tokenize = (s: string): string[] => (s.toLowerCase().match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? []);

interface Bm25Index {
  N: number;
  avgdl: number;
  df: Map<string, number>; // 词 → 出现于几个 chunk
  tf: Map<number, Map<string, number>>; // chunk.id → 词频表
  len: Map<number, number>; // chunk.id → token 数
}

/** BM25 参数：k1 词频饱和点、b 长度归一强度（取 Elasticsearch 默认值） */
const K1 = 1.2;
const B = 0.75;

function buildBm25(chunks: Chunk[]): Bm25Index {
  const df = new Map<string, number>();
  const tf = new Map<number, Map<string, number>>();
  const len = new Map<number, number>();
  for (const c of chunks) {
    const tokens = tokenize(c.text);
    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    tf.set(c.id, freq);
    len.set(c.id, tokens.length);
    for (const t of freq.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const avgdl = chunks.length ? [...len.values()].reduce((a, b) => a + b, 0) / chunks.length : 0;
  return { N: chunks.length, avgdl, df, tf, len };
}

/** Lucene 式 IDF：ln(1 + (N-df+0.5)/(df+0.5))，恒为正；经典 Robertson 式在 df>N/2 时会变负 */
function idf(idx: Bm25Index, t: string): number {
  const df = idx.df.get(t) ?? 0;
  return Math.log(1 + (idx.N - df + 0.5) / (df + 0.5));
}

/**
 * BM25 打分，替代朴素版的"命中 token 占比"：
 *   - IDF 加权：稀有词（"429" 全库 1 处）权重是常见字（"天" 5 处）的数倍——
 *     朴素版里它们同权重，"什么"这种无信息量的词在稀释分数
 *   - 词频饱和：同一词出现 3 次的收益 < 3 倍（k1 控制），防长文本刷分
 *   - 长度归一：短 chunk 命中 1 词比长 chunk 命中 1 词更相关（b 控制）
 */
function bm25Score(qTokens: string[], chunk: Chunk, idx: Bm25Index): number {
  const freq = idx.tf.get(chunk.id)!;
  const dl = idx.len.get(chunk.id)!;
  let s = 0;
  for (const t of qTokens) {
    const f = freq.get(t);
    if (!f) continue;
    s += idf(idx, t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * dl) / (idx.avgdl || 1))));
  }
  return s;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// ⓪ 查询改写：多轮对话 → 独立检索 query。
// "那它能删除吗？"里的代词必须先落地成"审计日志"，两路检索才有对象。
// 无对话历史时直通（单轮 query 本来就独立，不必多花一次调用）。
// 生产对照：独立小模型/规则改写（便宜）；本例用主模型顺手改。
// ---------------------------------------------------------------------------

async function rewriteQuery(history: ChatMsg[], query: string, trace = false): Promise<string> {
  if (!history.length || process.env.NO_REWRITE === '1') return query;
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '把用户的最新问题改写成不依赖对话历史的独立检索查询：把代词、省略还原成具体对象。' +
          '只输出改写后的查询本身，不要解释；问题已独立完整时原样输出。',
      },
      ...history,
      { role: 'user', content: query },
    ],
    max_tokens: 120,
    temperature: 0,
    ...(extraBody ?? {}),
  });
  const out = (r.choices[0].message.content ?? '')
    .trim()
    .replace(/^(改写后|改写|独立查询)[：:]?\s*/, '')
    .replace(/^["'「『]+|["'」』]+$/g, '');
  if (trace && out && out !== query) console.log(`   ⓪ 改写："${query}" → "${out}"`);
  return out || query;
}

// ---------------------------------------------------------------------------
// ⑤ 精排：漏斗的最后一层。对 (query, chunk) 逐对打分，归一到 0-1。
// 两条实现路线：
//   RERANK_MODEL → 专用 cross-encoder（/v1/rerank，Xinference/Jina/Cohere
//                  风格；OpenAI 官方至今没有 rerank API）
//   缺省         → LLM rerank：主模型逐对打分。贵一点、有提示词漂移，
//                  但零基础设施——生产没有专用 reranker 时的真实兜底方案
// ---------------------------------------------------------------------------

interface Candidate {
  chunk: Chunk;
  rrf: number; // ④ 的融合分
  vecScore: number | null; // 向量路余弦（未入该路召回则为 null）
  bm25: number | null; // BM25 路原始分（同上）
  score: number | null; // 精排归一分；null = 未精排（NO_RERANK）或解析失败
}

function sortByScore(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => {
    if (a.score === null && b.score === null) return b.rrf - a.rrf; // 都没分：保 RRF 序
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });
}

async function rerankCandidates(query: string, cands: Candidate[], _trace: boolean): Promise<Candidate[]> {
  if (process.env.NO_RERANK === '1') return cands; // 对照：跳过精排（也无阈值可用，回到"永远 top-k"）

  if (RERANK_MODEL) {
    try {
      const res = await fetch(`${client.baseURL.replace(/\/+$/, '')}/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.apiKey}` },
        body: JSON.stringify({ model: RERANK_MODEL, query, documents: cands.map((c) => c.chunk.text), top_n: cands.length }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results?: Array<{ index: number; relevance_score?: number }> };
      // 注意：不同后端的 relevance_score 量纲不同（sigmoid 0-1 或原始 logit），
      // 阈值必须按后端标定——这也是精排阈值要进评测、不能拍脑袋的原因
      const scores = new Map<number, number>();
      for (const r of data.results ?? []) {
        if (typeof r.relevance_score === 'number') scores.set(r.index, r.relevance_score);
      }
      return sortByScore(cands.map((c, i) => ({ ...c, score: scores.get(i) ?? null })));
    } catch (e) {
      console.log(`  ⚠️ 专用 reranker 调用失败（${(e as Error).message}），退回 LLM 打分兜底`);
    }
  }

  // LLM rerank：一次调用给全部候选打分。严格 JSON 输出 + 温度 0（判分要可复现）
  const list = cands.map((c, i) => `[${i + 1}] ${c.chunk.text}`).join('\n');
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是检索结果精排器。判断每个候选文档能否回答查询：10=能直接回答查询所问，' +
          '5=话题沾边但没有答案，0=完全无关。只输出 JSON 数组，每项形如 {"i":候选编号,"s":得分}，' +
          `共 ${cands.length} 项，不要输出任何其他内容。`,
      },
      { role: 'user', content: `查询：${query}\n候选文档：\n${list}` },
    ],
    max_tokens: 400,
    temperature: 0,
    ...(extraBody ?? {}),
  });
  const raw = (r.choices[0].message.content ?? '').trim();
  const scores = new Map<number, number>();
  const jsonSlice = raw.slice(Math.max(0, raw.indexOf('[')), raw.lastIndexOf(']') + 1);
  const collect = (items: Array<{ i: number; s: number }>) => {
    for (const item of items) {
      if (item && typeof item.i === 'number' && typeof item.s === 'number') {
        scores.set(item.i - 1, Math.max(0, Math.min(10, item.s)) / 10); // 归一到 0-1
      }
    }
  };
  try {
    collect(JSON.parse(jsonSlice));
  } catch {
    // 容错：整体解析失败就逐对象正则抢救；抢救不到的候选保留 RRF 序（score=null，不因解析失败被误杀）
    for (const m of raw.matchAll(/\{[^{}]*\}/g)) {
      try {
        collect([JSON.parse(m[0])]);
      } catch {
        /* 忽略坏对象 */
      }
    }
  }
  return sortByScore(cands.map((c, i) => ({ ...c, score: scores.get(i) ?? null })));
}

// ---------------------------------------------------------------------------
// ③④⑤ 检索管道主体：双路召回 → RRF 融合 → 精排 → 阈值 → top-k
// ---------------------------------------------------------------------------

const RECALL_N = 50; // 每路召回上限（生产 50-100；本语料 15 条全量即召回）
const RERANK_N = 10; // 送入精排的候选数——漏斗：召回 50 → 精排 10 → 最终 4
const RRF_K = 60; // RRF 常数（原论文/Elasticsearch rank_constant 默认值）

interface SearchOpts {
  history?: ChatMsg[]; // 传入则触发 ⓪ 改写
  k?: number;
  trace?: boolean;
}

async function search(rawQuery: string, opts: SearchOpts = {}) {
  const k = opts.k ?? 4;
  const trace = opts.trace ?? false;

  // ⓪ 查询改写（无历史 / NO_REWRITE=1 时直通）
  const query = await rewriteQuery(opts.history ?? [], rawQuery, trace);
  const qTokens = [...new Set(tokenize(query))];

  // ③a 向量路召回：全量 cosine（生产 = 向量库 ANN 索引，这里是暴力扫的等价物）
  let qVec: number[] | null = EMBED_MODEL && chunks.length ? (await embed([query]))[0] : null;
  // 防御式校验——两类真实坑都会让 cosine 静默变 NaN（0/0），不是报错：
  // ① 全零向量：SDK 与服务端 encoding 协议不一致时出现过（见 embed 注释）
  // ② 维度漂移：换 embedding 模型后没重建索引时出现
  // 对策：发现异常就把 query 和全部 chunk 放同一个 batch 重嵌（同批必然一致）
  const validDim = (v: number[] | null | undefined) => (v && v.some((x) => x !== 0) ? v.length : 0);
  const qDim = validDim(qVec);
  if (qDim && chunks.some((c) => validDim(c.vec) !== qDim)) {
    console.log(`  ⚠️ 检测到索引向量异常（全零或维度不一致）—— query+全部 chunk 同批重嵌兜底`);
    const all = await embed([query, ...chunks.map((c) => c.text)]);
    qVec = all[0];
    chunks.forEach((c, i) => (c.vec = all[i + 1]));
  }
  const vecRanked = qVec
    ? chunks
        .filter((c) => c.vec)
        .map((c) => ({ id: c.id, s: cosine(qVec!, c.vec!) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, RECALL_N)
    : [];

  // ③b BM25 路召回
  const kwRanked = chunks
    .map((c) => ({ id: c.id, s: bm25Score(qTokens, c, bm25Index) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, RECALL_N);

  // ④ RRF 融合：score = Σ 1/(RRF_K + 名次)。只看名次不看分数，
  // 两路量纲再不可比也无所谓——这是对朴素版加权融合的根本修正
  const chunkById = (id: number) => chunks.find((c) => c.id === id)!;
  const fused = new Map<number, Candidate>();
  for (const { list, isVec } of [
    { list: vecRanked, isVec: true },
    { list: kwRanked, isVec: false },
  ]) {
    for (const [rankIdx, item] of list.entries()) {
      const contrib = 1 / (RRF_K + rankIdx + 1);
      const prev = fused.get(item.id);
      if (prev) {
        prev.rrf += contrib;
        if (isVec) prev.vecScore = item.s;
        else prev.bm25 = item.s;
      } else {
        fused.set(item.id, {
          chunk: chunkById(item.id),
          rrf: contrib,
          vecScore: isVec ? item.s : null,
          bm25: isVec ? null : item.s,
          score: null,
        });
      }
    }
  }
  const candidates = [...fused.values()].sort((a, b) => b.rrf - a.rrf);

  // ⑤ 精排 + 阈值 + top-k：只对 RRF 前 RERANK_N 名逐对打分（精排贵，漏斗省它）
  const reranked = await rerankCandidates(query, candidates.slice(0, RERANK_N), trace);
  const hits = reranked.filter((c) => c.score === null || c.score >= RERANK_MIN).slice(0, k);

  if (trace) {
    console.log(
      `   管道：召回 向量${vecRanked.length}/BM25${kwRanked.length} → RRF 并集 ${candidates.length} → 精排 ${Math.min(candidates.length, RERANK_N)} → 阈值 ${RERANK_MIN} → 取 ${hits.length}`,
    );
    for (const [i, h] of hits.entries()) {
      console.log(
        `   [${i + 1}] ${h.chunk.docTitle} 向量=${h.vecScore !== null ? h.vecScore.toFixed(3) : '  -  '} ` +
          `BM25=${h.bm25 !== null ? h.bm25.toFixed(2) : ' - '} RRF=${h.rrf.toFixed(4)} ` +
          `精排=${h.score !== null ? h.score.toFixed(1) : ' - '} | ${h.chunk.text.slice(0, 24)}…`,
      );
    }
    if (!hits.length && reranked.length) {
      const top = reranked
        .slice(0, 3)
        .map((c) => c.score?.toFixed(1) ?? '?')
        .join(' / ');
      console.log(`   全部候选被阈值拦下（最高分 ${top} < ${RERANK_MIN}）→ 拒答`);
    }
  }
  return { query, hits };
}

// ---------------------------------------------------------------------------
// ⑥ 生成 + 引用校验
// ---------------------------------------------------------------------------

interface RagAnswer {
  answer: string;
  hits: Candidate[];
  citations: number[]; // 回答里实际引用的编号
  citationsValid: boolean; // 编号是否都真实存在
  query: string; // 实际用于检索的 query（改写后）
}

async function answerWithRAG(rawQuery: string, opts: { history?: ChatMsg[]; trace?: boolean } = {}): Promise<RagAnswer> {
  const { query, hits } = await search(rawQuery, { ...opts, k: 4 });
  if (!hits.length) {
    // 检索层拒答：所有候选低于阈值，一个都不塞给模型。
    // 朴素版会硬塞 top-4 不相关 chunk，赌模型自己说"未提及"——把识别
    // 不相关的活儿交给最贵的组件；生产把这道闸门放在检索层，便宜且确定
    return { answer: '资料中未提及。', hits, citations: [], citationsValid: true, query };
  }
  const context = hits.map((h, i) => `[${i + 1}] （来源：${h.chunk.docTitle}）\n${h.chunk.text}`).join('\n\n');
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是公司知识助手。仅依据下面的资料回答，每个事实陈述的句末标注资料编号，如 [1]。\n' +
          '资料里没有的信息就明确回答"资料中未提及"，禁止编造。回答不超过三句话。\n\n' +
          `=== 资料 ===\n${context}`,
      },
      { role: 'user', content: query },
    ],
    max_tokens: 400,
    ...(extraBody ?? {}),
  });
  const answer = r.choices[0].message.content ?? '';
  const citations = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const citationsValid = citations.length > 0 && citations.every((n) => n >= 1 && n <= hits.length);
  return { answer, hits, citations, citationsValid, query };
}

/** 裸答：不给任何资料，直接问——演示"没有可核验性"是什么样 */
async function bareAnswer(query: string): Promise<string> {
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: '你是公司知识助手，用一两句话回答。' }, { role: 'user', content: query }],
    max_tokens: 300,
    ...(extraBody ?? {}),
  });
  return r.choices[0].message.content ?? '';
}

// ---------------------------------------------------------------------------
// ⑦ 评测：golden 集 + recall@4 / MRR。检索质量先变成数字，调参才有依据。
// 生产对照：RAGAS 全套（忠实度/答案相关性/上下文精确率…）、线上抽样回归。
// ---------------------------------------------------------------------------

const GOLDEN: Array<{ q: string; expect: RegExp }> = [
  { q: '单笔订单退款的上限金额是多少？', expect: /金额上限为 5000/ },
  { q: '收货之后多久之内必须申请退款？', expect: /30 天内发起退款/ },
  { q: '数字内容下载过了还给退吗？', expect: /已下载的数字内容/ },
  { q: 'API 返回 429 是什么意思？', expect: /状态码 429/ },
  { q: '免费档每分钟最多调用多少次？', expect: /每分钟 60 次/ },
  { q: '用量超限后服务会被直接切断吗？', expect: /临时降级/ },
  { q: '审计日志保留多长时间？', expect: /审计日志保留 180/ },
  { q: '链路传输有什么强制的加密要求？', expect: /TLS 1.2/ },
];

async function evalGolden() {
  console.log('========= 评测：golden 集（recall@4 / MRR）=========');
  let hitCount = 0;
  let mrrSum = 0;
  for (const g of GOLDEN) {
    const { hits } = await search(g.q, { k: 4 });
    const rank = hits.findIndex((h) => g.expect.test(h.chunk.text)) + 1;
    const ok = rank > 0;
    if (ok) {
      hitCount++;
      mrrSum += 1 / rank;
      console.log(`   ✓ 命中@${rank}  ${g.q}`);
    } else {
      console.log(`   ✗ 未进top4  ${g.q}`);
    }
  }
  console.log(`   recall@4 = ${hitCount}/${GOLDEN.length}，MRR = ${(mrrSum / GOLDEN.length).toFixed(2)}`);
  console.log('   ↑ 阈值/召回深度/要不要 rerank，都靠这组数字对比着调，不靠感觉（工业界完整版：RAGAS，对照 11 例）');
}

// ---------------------------------------------------------------------------
// 演示：幻觉对照 + 五个问题（精确细节 / BM25 救场 / 语义救场 / 多轮改写 / 拒答）
// ---------------------------------------------------------------------------

const chunks = chunkDocs();
const bm25Index = buildBm25(chunks);

async function main() {
  console.log('========= 索引阶段 =========');
  await buildIndex(chunks);
  console.log(`BM25 索引：${bm25Index.N} 个 chunk，平均长度 ${bm25Index.avgdl.toFixed(1)} token（df/词频表写入时算一次）`);
  // IDF 直观对照：同是 query 里的 token，稀有词权重是常见词的数倍——
  // 朴素版"命中占比"里它们同权，"什么""怎样"这类词在白白稀释分数
  for (const t of ['429', '退', '天']) {
    console.log(`   IDF："${t}" 出现于 ${bm25Index.df.get(t) ?? 0} 个 chunk → idf=${idf(bm25Index, t).toFixed(2)}`);
  }
  console.log(`（共 ${chunks.length} 个 chunk，来自 ${DOCS.length} 篇文档）\n`);

  // ---- Q1：幻觉对照——同一个私有知识问题，裸答 vs RAG ----
  const q1 = '我们公司单笔退款的上限金额和申请期限分别是多少？';
  console.log(`========= Q1 幻觉对照：${q1} =========`);
  console.log('【裸答 · 无检索】模型没有公司知识：');
  const bare = await bareAnswer(q1);
  console.log(`   ${bare.replace(/\n/g, ' ')}`);
  console.log('   ↑ 数字要么编、要么碰运气——这次可能蒙对，换个问法或再跑一次就可能错，');
  console.log('     关键是对错无法核验（上一次运行它答的是"15 个自然日"）');
  console.log('【RAG 答 · 生产管道】检索明细（两路召回 → RRF → 精排）：');
  const a1 = await answerWithRAG(q1, { trace: true });
  console.log(`   ${a1.answer.replace(/\n/g, ' ')}`);
  console.log(
    a1.citationsValid
      ? `   ✓ 引用 ${a1.citations.join(', ')} 全部真实存在（编号范围 1-${a1.hits.length}）`
      : `   ✗ 引用异常：回答里出现 [${a1.citations.join(', ')}]，但资料只有 1-${a1.hits.length} —— 引用幻觉`,
  );

  // ---- Q2：BM25 路（IDF 让 "429" 这种稀有 token 拿到高权重）----
  const q2 = '调用 API 返回 429 是什么意思？免费档每分钟最多几次请求？';
  console.log(`\n========= Q2 关键词路（BM25 + IDF）=========`);
  console.log(`问：${q2}`);
  const a2 = await answerWithRAG(q2, { trace: true });
  console.log(`答：${a2.answer.replace(/\n/g, ' ')}`);
  console.log(a2.citationsValid ? `   ✓ 引用 ${a2.citations.join(', ')} 有效` : '   ✗ 引用异常或缺失');
  console.log('   （"429" 全库仅 1 处、IDF 最高，BM25 路直接锁定；朴素版里它和"什么"同权重）');

  // ---- Q3：语义路（措辞完全不同，靠 embedding 近邻召回）----
  const q3 = '客户用量超了会直接断服务吗？体验会变成什么样？';
  console.log(`\n========= Q3 语义路（向量召回 + 精排确认）=========`);
  console.log(`问：${q3}`);
  const a3 = await answerWithRAG(q3, { trace: true });
  console.log(`答：${a3.answer.replace(/\n/g, ' ')}`);
  console.log(a3.citationsValid ? `   ✓ 引用 ${a3.citations.join(', ')} 有效` : '   ✗ 引用异常或缺失');
  console.log('   （"断服务"≠"降级排队"：字面几乎不重合，BM25 拿不到分，向量路召回后由精排确认）');

  // ---- Q4：多轮改写——代词必须先落地成实体，否则检索对象就是错的 ----
  console.log(`\n========= Q4 多轮改写："它"是谁，检索层自己猜不出来 =========`);
  const q4a = '审计日志保留多长时间？';
  console.log(`第 1 轮 问：${q4a}`);
  const a4a = await answerWithRAG(q4a);
  console.log(`     答：${a4a.answer.replace(/\n/g, ' ')}`);
  const history: ChatMsg[] = [
    { role: 'user', content: q4a },
    { role: 'assistant', content: a4a.answer },
  ];
  const q4b = '那它能删除吗？';
  console.log(`第 2 轮 问：${q4b}（"它" = 审计日志）`);
  console.log('【对照 · 不改写直接检索】代词留在 query 里，命中的对象是错的：');
  await search(q4b, { trace: true });
  console.log('   ↑ 命中的是"日志删除/数据删除请求"——问的是审计日志，检索层根本不知道"它"是谁');
  console.log('【改写后检索】');
  const a4b = await answerWithRAG(q4b, { history, trace: true });
  console.log(`   答：${a4b.answer.replace(/\n/g, ' ')}`);
  console.log(`   ↑ 改写成 "${a4b.query}" 后命中审计日志条款（只读不可篡改）。多轮对话不改写，再好的检索也白搭`);

  // ---- Q5：拒答阈值——检索层就敢说"没有"，不硬塞 ----
  console.log(`\n========= Q5 拒答阈值：语料里没有的问题 =========`);
  const q5 = '我们公司年假有几天？';
  console.log(`问：${q5}`);
  const a5 = await answerWithRAG(q5, { trace: true });
  console.log(`答：${a5.answer.replace(/\n/g, ' ')}`);
  console.log('   ↑ 精排得分全部低于阈值 → hits=0 → 拒答。朴素版永远硬塞 top-4 不相关 chunk，');
  console.log('     把"识别不相关"的压力全丢给生成模型；生产把闸门放在检索层——便宜、确定、可测');

  // ---- ⑦ 评测 ----
  console.log('');
  await evalGolden();

  console.log('\n========= 生产对照（本例已落地 vs 仍差基础设施）=========');
  console.log('  已落地（算法层）：查询改写 / BM25+IDF / RRF 融合 / LLM 精排+阈值 / golden 评测');
  console.log('  仍差距（基础设施层）：');
  console.log('  - 向量库（pgvector/Milvus/…）：百万级 chunk 用 ANN 索引，demo 的全量扫描扛不住量');
  console.log('  - 专用 reranker 服务（Qwen3-Reranker/BGE）：比 LLM 打分便宜一个量级，且无提示词漂移');
  console.log('  - 中文分词库（jieba/IK）：单字近似丢了词级信号——"审计日志"应是 1 个词，不是 4 个字');
  console.log('  - 引用校验升级到"被引句真的支持陈述"（NLI）；评测升级为 RAGAS 全套 + 线上抽样回归');
}

main();
