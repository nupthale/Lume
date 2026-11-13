/**
 * ============================================================
 * 03 — 分层记忆（Layered Memory）
 * 对照场景: templates/template-company-knowledge、Mastra Memory 体系
 * ============================================================
 *
 * 问题 2 的回答：记忆如何分层？什么时候读、什么时候写？
 *
 * 记忆分层的本质动机：上下文窗口有限且贵，但信息的时间价值不同。
 *
 *   ┌─ Layer 1: Working Memory（工作记忆）
 *   │   "用户档案"——永远在上下文里的一小块结构化信息
 *   │   （名字、偏好、当前目标）。Mastra: workingMemory 模板。
 *   │   特点：小（几百 token）、每轮都在、模型可以主动更新它
 *   │
 *   ├─ Layer 2: Episodic Memory（情景记忆）
 *   │   按会话存的对话历史。本例落到数据库：sessions + messages 两张表，
 *   │   一行一条消息、append-only 全量写；模型读"最近 N 条"的裁剪视图，
 *   │   用户回看读全量——裁剪只发生在读取时，存储层永远完整。
 *   │   被裁掉的旧轮次不消失：增量并入 sessions.summary 的 rolling summary，
 *   │   注入 system prompt——"历史摘要 + 最近 N 条"才是完整的 episodic 视图
 *   │
 *   └─ Layer 3: Semantic Memory（语义记忆）
 *       从对话中"提炼"出的持久事实（"用户对花生过敏"），
 *       存成独立条目，按与当前话题的相关性检索 top-k 注入。
 *       特点：跨会话、可积累、需要检索（真实系统用向量库）
 *
 * 读写时机（记住这两句就够了）：
 *   读 = 每次 LLM 调用前，组装 system prompt 时注入
 *        （working memory 全量注入 + 本会话 rolling summary + semantic 检索 top-k
 *         + episodic 最近 N 条逐字）
 *   写 = episodic 每条消息到达即落库（append-only）；被裁掉的旧轮次增量并入
 *        sessions.summary（水位线推进）；每轮结束后再异步跑一次"提炼"调用，
 *        把持久事实抽出来存进 semantic 层
 *
 * 这个"读前注入、写后提炼"的闭环，就是 Mastra Memory / ChatGPT Memory
 * / LangGraph Store 的共同骨架。
 *
 * 运行: npx tsx 03-memory/index.ts
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
/** 语义检索用的 embedding 模型（同一 Xinference 服务上部署），设 NO_EMBED=1 退回关键词检索 */
const EMBED_MODEL = process.env.NO_EMBED === '1' ? undefined : (process.env.EMBED_MODEL ?? 'Qwen3-Embedding-8B');

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

// ---------------------------------------------------------------------------
// Layer 3: SemanticMemory — 持久事实的存储与检索
// 检索方式：设了 EMBED_MODEL（如 Qwen3-Embedding-8B）时用 embedding 余弦相似度，
// 否则退回关键词重合度。这正是 Mastra semanticRecall 的两种模式。
// ---------------------------------------------------------------------------

interface Fact {
  id: string;
  content: string;
  createdAt: string;
  embedding?: number[]; // 有 embedding 服务时缓存每个事实的向量
}

/** 调 embedding 接口把文本变成向量（维度由模型决定，Qwen3-Embedding-8B 是 4096 维） */
async function embed(texts: string[]): Promise<number[][]> {
  const response = await client.embeddings.create({
    model: EMBED_MODEL!,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

/** 余弦相似度：两个向量夹角的 cos 值，[-1, 1]，越大越相似 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class SemanticMemory {
  private facts: Fact[] = [];
  private nextId = 1;

  /**
   * 写入时机 ①：每轮对话结束后调用。
   * 用一次独立的 LLM 调用做"提炼"：从这轮对话里抽取值得长期记住的事实。
   * （另一种写法：让主 agent 在对话中直接调用 record_fact 工具，见下方 ②）
   */
  async extractFromTurn(userMessage: string, assistantMessage: string) {
    const response = await client.chat.completions.create({
      model: MODEL,
      // 用 tool call 拿结构化输出——比解析自由文本可靠得多，这是通用技巧
      messages: [
        {
          role: 'system',
          content:
            '你是记忆提炼器。从对话中抽取"跨会话仍然成立"的持久事实（用户姓名、偏好、健康信息、重要目标等）。' +
            '忽略只对当前对话有意义的临时内容（比如"今天天气怎么样"）。没有值得记的就返回空数组。',
        },
        { role: 'user', content: `用户: ${userMessage}\n助手: ${assistantMessage}` },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'save_facts',
            description: '保存抽取出的持久事实',
            parameters: {
              type: 'object',
              properties: {
                facts: { type: 'array', items: { type: 'string' } },
              },
              required: ['facts'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'save_facts' } }, // 强制调用
      ...(extraBody ?? {}),
    });

    const raw = response.choices[0].message.tool_calls?.find((c) => c.type === 'function')?.function.arguments;
    const extracted: string[] = raw ? JSON.parse(raw).facts : [];

    // 去重合并：这里用简单包含判断，生产用相似度阈值
    const newFacts: string[] = [];
    for (const fact of extracted) {
      const duplicate = this.facts.some((f) => f.content.includes(fact) || fact.includes(f.content));
      if (!duplicate) {
        newFacts.push(fact);
        console.log(`    💾 语义记忆写入: "${fact}"`);
      }
    }

    // 有 embedding 服务时，批量把新事实转成向量存起来（写入时算一次，检索时复用）
    if (newFacts.length && EMBED_MODEL) {
      const vectors = await embed(newFacts);
      newFacts.forEach((content, i) => {
        this.facts.push({ id: `fact-${this.nextId++}`, content, createdAt: new Date().toISOString(), embedding: vectors[i] });
      });
    } else {
      newFacts.forEach((content) => {
        this.facts.push({ id: `fact-${this.nextId++}`, content, createdAt: new Date().toISOString() });
      });
    }
  }

  /**
   * 读取时机 ①：每次 LLM 调用前，用当前用户输入做 query 检索相关事实。
   * 真实系统：embed(query) → 向量库 ANN 检索 top-k。
   * 这里：内存全量比对（事实少时够用），embedding 模式或关键词模式。
   */
  async retrieve(query: string, topK = 3): Promise<Fact[]> {
    // ---- embedding 检索：语义相近即可召回，"推荐午饭"能命中"花生过敏" ----
    if (EMBED_MODEL && this.facts.length) {
      const [queryVector] = await embed([query]);
      return this.facts
        .map((fact) => ({ fact, score: cosineSimilarity(queryVector, fact.embedding!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((x) => x.fact);
    }

    // ---- 关键词检索（无 embedding 服务时的 fallback）：字面重合才能召回 ----
    const tokens = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const q = tokens(query);
    return this.facts
      .map((fact) => ({
        fact,
        score: [...tokens(fact.content)].filter((t) => q.has(t)).length,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => x.fact);
  }

  all(): Fact[] {
    return this.facts;
  }
}

// ---------------------------------------------------------------------------
// Layer 1: WorkingMemory — 永远在上下文里的用户档案
// 模型通过 update_working_memory 工具主动更新它。
// 生产级三件套（一句 description 只能解决"何时触发"，解决不了"写成什么样"）：
//   ① 种子模板——结构长在初始内容里，分区注释就是给模型的就地更新指南（Mastra 同款：模板即 prompt）
//   ② 工具描述带政策——何时触发 + 整块重写 + 删除已完成 + 搁置降级 + 大小上限
//   ③ 结构化参数——分区拆开传、未变的原样传回；标题行/空缺兜底/注释剥离由合并代码确定性保证
// ---------------------------------------------------------------------------

class WorkingMemory {
  /** 种子模板：模型每轮都在 system prompt 里看到它，注释就是分区维护规则 */
  static readonly TEMPLATE = [
    '# 用户信息',
    '<!-- 姓名、长期偏好、健康信息。只在用户明确给出新信息时更新，未变化的部分原样保留 -->',
    '',
    '# 当前目标',
    '<!-- 本会话正在做的事，一行一条。话题切换时：已完成/放弃的删除；被搁置的移到下方"搁置"区 -->',
    '',
    '# 搁置',
    '<!-- 用户可能回头继续的事，一行一条。最多 3 条，超出删最旧的（原文在对话历史里，可恢复） -->',
  ].join('\n');

  content = WorkingMemory.TEMPLATE;

  buildTool(): OpenAI.Chat.Completions.ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: 'update_working_memory',
        description:
          '更新用户档案（工作记忆）。何时调用：用户给出新的个人信息/偏好，或目标变化' +
          '（新增、完成、放弃、话题切换）。怎么写：所有分区都传最新完整内容——整块重写而非追加，' +
          '未变化的分区原样传回；已完成/放弃的目标直接删除；话题切换时未完成的目标移入 shelved；' +
          '全部内容控制在 300 token 以内。',
        parameters: {
          type: 'object',
          properties: {
            userInfo: { type: 'string', description: '"用户信息"区的最新完整内容（不含标题行和注释），未变化则原样传回' },
            goals: { type: 'string', description: '"当前目标"区的最新完整内容（不含标题行和注释），一行一条，无目标传空字符串' },
            shelved: { type: 'string', description: '"搁置"区的最新完整内容（不含标题行和注释），一行一条，最多 3 条' },
          },
          required: ['userInfo', 'goals', 'shelved'],
        },
      },
    };
  }

  /** 分区合并：确定性代码，不依赖模型自觉——标题行、空缺兜底、注释剥离都由这里保证 */
  handleUpdate(userInfo: string, goals: string, shelved: string) {
    this.content =
      `# 用户信息\n${userInfo.trim() || '（暂无）'}\n\n` +
      `# 当前目标\n${goals.trim() || '（暂无）'}\n\n` +
      `# 搁置\n${shelved.trim() || '（暂无）'}`;
    console.log(`    📝 工作记忆更新:\n${this.content.split('\n').map((l) => `       ${l}`).join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// Layer 2: EpisodicMemory — 情景记忆的数据库存取 + rolling summary 压缩
// 对照真实系统的表结构（假设现成的表，DDL 如下）：
//
//   CREATE TABLE sessions (
//     id                  TEXT PRIMARY KEY,
//     user_id             TEXT NOT NULL,
//     summary             TEXT,              -- rolling summary：被裁掉的旧轮次的压缩要点
//     summarized_until_id BIGINT DEFAULT 0,  -- 水位线：messages.id <= 此值的行已被摘要覆盖
//     created_at          TIMESTAMP DEFAULT now()
//   );
//
//   CREATE TABLE messages (               -- 一行一条消息，append-only
//     id           BIGSERIAL PRIMARY KEY,
//     session_id   TEXT NOT NULL,
//     role         TEXT NOT NULL,         -- user / assistant / tool
//     content      TEXT,
//     tool_calls   JSONB,                -- assistant 发起的工具调用
//     tool_call_id TEXT,                 -- tool 结果对应的调用 id
//     created_at   TIMESTAMP DEFAULT now()
//   );
//   CREATE INDEX idx_messages_session ON messages (session_id, id);
//
// 设计要点——"写全量、读裁剪"：
//   写 = 每条消息到达就 INSERT 一行，永不 UPDATE/DELETE。
//       用户回看、审计、重放、日后升级记忆策略，都依赖完整原文。
//   读 = 同一张表、两种查询、两个消费方：
//       UI 回看   → 全量：  WHERE session_id = ? ORDER BY id
//       模型上下文 → 裁剪：  WHERE session_id = ? ORDER BY id DESC LIMIT N（读回后翻转）
//   system prompt 不落库：它由 working/semantic 记忆每轮动态组装，属于"视图"而非历史。
//   压缩 = 旧轮次被裁掉但不消失：把"水位线 → 裁剪切点"之间的增量轮次与已有 summary
//   做一次增量合并（每次只碰增量，O(增量) 而非 O(会话总长)），水位线随之单调前移。
//   这是全系统唯一的非 append 写入，且只 UPDATE sessions 自己的行，messages 永不改。
// ---------------------------------------------------------------------------

interface MessageRow {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null;
  tool_call_id?: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  summary: string | null; // rolling summary（null = 还没有需要压缩的历史）
  summarized_until_id: number; // 水位线：messages.id <= 此值的行已被摘要覆盖
  created_at: string;
}

/** 模拟数据库：内存实现，接口语义与 SQL 一致。接真实库时只需把这个类换成 pg/mysql 驱动实现 */
class MockDB {
  private sessions = new Map<string, SessionRow>();
  private messages: MessageRow[] = [];
  private nextId = 1;
  private nextSession = 1;

  /** INSERT INTO sessions (user_id) VALUES (?) RETURNING id */
  insertSession(userId: string): string {
    const id = `session-${this.nextSession++}`;
    this.sessions.set(id, { id, user_id: userId, summary: null, summarized_until_id: 0, created_at: new Date().toISOString() });
    console.log(`    🗄️ sessions 落库: ${id} (user=${userId})`);
    return id;
  }

  /** SELECT * FROM sessions WHERE id = ? */
  getSession(id: string): SessionRow {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`session ${id} 不存在`);
    return { ...s };
  }

  /** UPDATE sessions SET summary=?, summarized_until_id=? WHERE id=? */
  updateSessionSummary(id: string, summary: string, summarizedUntilId: number) {
    const s = this.sessions.get(id)!;
    s.summary = summary;
    s.summarized_until_id = summarizedUntilId;
  }

  /** INSERT INTO messages (...) VALUES (...) — append-only，一条消息一行 */
  insertMessage(row: Omit<MessageRow, 'id' | 'created_at'>): number {
    const id = this.nextId++;
    this.messages.push({ ...row, id, created_at: new Date().toISOString() });
    console.log(`    🗄️ messages 落库: #${id} [${row.role}]`);
    return id;
  }

  /** 读 ① UI 回看：SELECT * FROM messages WHERE session_id = ? ORDER BY id（全量，不裁剪） */
  getHistory(sessionId: string): MessageRow[] {
    return this.messages.filter((m) => m.session_id === sessionId);
  }

  /**
   * 读 ② 模型上下文：… ORDER BY id DESC LIMIT ? 读回后翻转（裁剪视图，存储层不受影响）。
   * 切点必须落在轮次边界上：窗口起点必须是 user 行——一问一答保持成对，
   * 也顺带保证 tool 结果不会脱离发起它的 assistant(tool_calls)（否则协议直接报错）。
   */
  getRecent(sessionId: string, limit: number): MessageRow[] {
    const recent = this.messages.filter((m) => m.session_id === sessionId).slice(-limit);
    const rows = [...recent];
    while (rows.length && rows[0].role !== 'user') rows.shift();
    return rows;
  }

  /** 区间读：SELECT … WHERE session_id=? AND id > :after AND id < :before ORDER BY id（压缩增量用） */
  getRange(sessionId: string, afterId: number, beforeId: number): MessageRow[] {
    return this.messages.filter((m) => m.session_id === sessionId && m.id > afterId && m.id < beforeId);
  }
}

/** DB 行 → OpenAI 协议消息：读取时重建（真实库把 tool_calls/tool_call_id 从 JSONB 列还原） */
function rowToMessage(row: MessageRow): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (row.role === 'tool') return { role: 'tool', tool_call_id: row.tool_call_id!, content: row.content ?? '' };
  if (row.role === 'assistant' && row.tool_calls) return { role: 'assistant', content: row.content, tool_calls: row.tool_calls };
  return { role: row.role, content: row.content ?? '' };
}

// ---------------------------------------------------------------------------
// 组装三层记忆 + agent loop（复用 01 的循环，增加注入和提炼）
// ---------------------------------------------------------------------------

const semanticMemory = new SemanticMemory();
const workingMemory = new WorkingMemory();
const db = new MockDB();
/** 模型上下文保留的 episodic 历史条数。demo 故意设小，让第 3 轮就触发裁剪+压缩；
 * 生产上按 token 预算裁（如估算超窗口 70% 才压，而不是每轮都压），切点沿轮次边界 */
const EPISODIC_LIMIT = 3;

/**
 * Layer 2 压缩（写入时机 ③）：rolling summary 的增量合并。
 * 把"水位线之后、裁剪切点之前"的未覆盖旧轮次，与已有摘要做一次 LLM 合并，
 * 水位线前移到增量末尾——下次压缩只碰这之后的增量，成本 O(增量) 而非 O(会话总长)。
 * 摘要存成要点列表而非散文：新要点直接并入，避免"摘要的摘要"复利式失真。
 */
async function compactEpisodic(sessionId: string): Promise<string> {
  const session = db.getSession(sessionId);
  const recent = db.getRecent(sessionId, EPISODIC_LIMIT);
  // 裁剪切点：recent 为空说明尾部整段被轮次边界规则收走 → 全部剩余历史都该进摘要
  const cutId = recent[0]?.id ?? Number.MAX_SAFE_INTEGER;
  const uncovered = db.getRange(sessionId, session.summarized_until_id, cutId);
  if (!uncovered.length) return session.summary ?? ''; // 无增量：直接用现成摘要，零 LLM 成本

  const transcript = uncovered
    .filter((r) => r.role !== 'tool' && r.content) // tool 结果（"ok"）对摘要没有信息量
    .map((r) => `${r.role === 'user' ? '用户' : '助手'}: ${r.content!.replace(/\n/g, ' ').slice(0, 200)}`)
    .join('\n');

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是对话摘要器。把【已有摘要】与【新增对话】合并成一份最新的要点列表（每行一条，以 "- " 开头）。' +
          '保留：用户姓名/偏好/健康信息/长期目标、双方达成的决策与结论、未完成事项；' +
          '丢弃寒暄和只对当时有意义的内容。直接输出列表，不要任何多余文字。',
      },
      { role: 'user', content: `【已有摘要】\n${session.summary || '（无）'}\n\n【新增对话】\n${transcript}` },
    ],
    ...(extraBody ?? {}),
  });
  const merged = response.choices[0].message.content ?? '';
  db.updateSessionSummary(sessionId, merged, uncovered[uncovered.length - 1].id);
  console.log(
    `    🗜️ 滚动摘要: 并入 #${uncovered[0].id}~#${uncovered[uncovered.length - 1].id}（${uncovered.length} 行），水位线 → #${uncovered[uncovered.length - 1].id}`,
  );
  return merged;
}

async function chat(sessionId: string, userMessage: string): Promise<string> {
  console.log(`\n📥 用户: ${userMessage}`);

  // ===== 读取时机：LLM 调用前组装上下文 =====
  const relevantFacts = await semanticMemory.retrieve(userMessage);
  // Layer 2 前置：先把"将被裁掉、且摘要未覆盖"的旧轮次增量并入 rolling summary
  const summary = await compactEpisodic(sessionId);
  const systemPrompt =
    '你是一个贴心的个人助理。\n\n' +
    // Layer 1: working memory 全量注入
    `## 用户档案（工作记忆）\n${workingMemory.content}\n` +
    // Layer 2: rolling summary 注入（本会话被裁掉的旧轮次的压缩要点）
    (summary ? `\n## 前情摘要（本会话更早的对话，已压缩为要点）\n${summary}\n` : '') +
    // Layer 3: semantic memory 检索 top-k 注入
    (relevantFacts.length
      ? `\n## 相关长期记忆\n${relevantFacts.map((f) => `- ${f.content}`).join('\n')}\n`
      : '');
  if (summary) console.log(`    📜 注入前情摘要: ${summary.replace(/\n/g, ' ⏎ ').slice(0, 80)}${summary.length > 80 ? '…' : ''}`);
  if (relevantFacts.length) console.log(`    🔍 检索到长期记忆: ${relevantFacts.map((f) => f.content).join(' | ')}`);

  // Layer 2: episodic 读"最近 N 条"的裁剪视图，与摘要互补——摘要覆盖水位线之前的
  // 旧轮次，getRecent 覆盖切点之后的近期轮次，两者恰好不重叠地拼成完整历史。
  // system 不落库、每轮动态重写；assistant/tool 的结构化字段由 rowToMessage 从行还原
  const history = db.getRecent(sessionId, EPISODIC_LIMIT).map(rowToMessage);
  const context: Messages = [{ role: 'system', content: systemPrompt }, ...history];

  // ===== 写入时机（episodic）：user 消息到达即落库（append-only），再进本轮上下文 =====
  db.insertMessage({ session_id: sessionId, role: 'user', content: userMessage });
  context.push({ role: 'user', content: userMessage });

  // agent loop（和 01 相同，多了 working memory 工具；期间每条消息产生即落库）
  while (true) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: context,
      tools: [workingMemory.buildTool()],
      ...(extraBody ?? {}),
    });
    const msg = response.choices[0].message;
    db.insertMessage({
      session_id: sessionId,
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: msg.tool_calls ?? null,
    });
    context.push(msg);

    if (!msg.tool_calls?.length) {
      // ===== 写入时机 ②：这轮结束后，异步提炼语义记忆 =====
      // 生产环境可以 fire-and-forget，不阻塞用户
      await semanticMemory.extractFromTurn(userMessage, msg.content ?? '');
      console.log(`🤖 回复: ${msg.content}`);
      return msg.content ?? '';
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      if (call.function.name === 'update_working_memory') {
        const { userInfo, goals, shelved } = JSON.parse(call.function.arguments);
        workingMemory.handleUpdate(userInfo ?? '', goals ?? '', shelved ?? '');
      }
      db.insertMessage({ session_id: sessionId, role: 'tool', content: 'ok', tool_call_id: call.id });
      context.push({ role: 'tool', tool_call_id: call.id, content: 'ok' });
    }
  }
}

// ---------------------------------------------------------------------------
// 演示：会话 A 两轮（验证 episodic 落库与读回）→ 新会话 B 验证跨会 semantic 记忆
// → 最后 getHistory 全量回看，证明"裁剪只是读取视图，存储层永远完整"
// ---------------------------------------------------------------------------

async function main() {
  console.log('========= 会话 A（同一会话多轮，episodic 走数据库读写）=========');
  const sessionA = db.insertSession('user-001');
  await chat(sessionA, '我叫小李，对花生严重过敏，最近在增肌，目标每天吃 150g 蛋白质');
  // 第二轮：上一轮的消息已在库里，chat() 用 getRecent 读回裁剪视图拼进上下文
  await chat(sessionA, '根据我刚才告诉你的信息，总结一下我饮食上要注意什么？');
  // 第三轮：EPISODIC_LIMIT 很小，最早的轮次已被裁掉并并入摘要 → 这轮只能靠前情摘要回答
  await chat(sessionA, '帮我安排今天的午饭和晚饭');

  console.log('\n========= 会话 B（新 session 行，episodic 层为空）=========');
  const sessionB = db.insertSession('user-001');
  // 新会话的 episodic 层是空的，但 semantic 层跨会话共享 → 模型应该记得过敏
  await chat(sessionB, '帮我推荐个午饭');

  console.log('\n========= UI 回看会话 A：getHistory 全量（模型只见裁剪视图，存储永远完整）=========');
  for (const row of db.getHistory(sessionA)) {
    const text = (row.content ?? '').replace(/\n/g, ' ');
    console.log(`- #${row.id} [${row.role}]${row.tool_calls?.length ? '（发起工具调用）' : ''} ${text.length > 40 ? text.slice(0, 40) + '…' : text}`);
  }

  console.log('\n========= 会话 A 的 rolling summary（sessions.summary，水位线之前的历史都在这）=========');
  const s = db.getSession(sessionA);
  console.log(`水位线 summarized_until_id = ${s.summarized_until_id}（id <= 此值的 messages 已被摘要覆盖）`);
  console.log(s.summary ?? '（无）');

  console.log('\n========= 最终语义记忆库 =========');
  for (const f of semanticMemory.all()) console.log(`- [${f.id}] ${f.content}`);
}

main();
