/**
 * ============================================================
 * 19 — mem0 版分层记忆（Layered Memory with mem0）
 * 对照场景: 03-memory（手写三层）、mem0 OSS TS SDK（mem0ai/oss）
 * ============================================================
 *
 * 本例 = 03-memory 原样保留 Layer 1 / Layer 2，只把 Layer 3 的
 * 手写 SemanticMemory 换成 mem0（npm 包 mem0ai，OSS 入口 mem0ai/oss）。
 *
 * 为什么值得换？03 的手写版有两个硬伤，恰好都是 mem0 的核心卖点：
 *
 *   ① 提炼质量：03 用"字符串包含判断"去重——字面稍有出入就算新事实，
 *      "我对花生过敏"和"用户花生严重过敏"会存成两条。mem0 v3 的 add()
 *      是"增量提炼"管道（官方称 token-efficient 算法，2026-04 起 v2/v3
 *      SDK 的默认）：
 *        先把本轮对话 embed → 向量召回同 scope 下最相似的已有记忆 →
 *        连同对话一起塞进提取 prompt → 一次 LLM 调用抽出"自包含的
 *        事实陈述"（LLM 看得到已有记忆，天然不重复提取；比包含判断
 *        强一个量级）→ 再加 md5 hash 确定性去重后写入。
 *      顺带还会抽实体（人名/地点/组织）建实体索引，检索时给共享实体
 *      的记忆加权。注意：v2 经典版"召回相似记忆后让 LLM 决策
 *      ADD/UPDATE/DELETE"的巩固阶段，在 v3 的 add() 里被简化成
 *      ADD-only——冲突演化（用户改口"我现在吃素了"）要靠宿主显式调
 *      update()/delete() API，或 Platform 版的 decay/冲突解决特性。
 *
 *   ② 检索基建：03 手写 embed() + 余弦相似度 + 内存数组全量比对。
 *      mem0 内部同样是一行 cosineSimilarity（读它的源码你会发现和 03
 *      写得几乎一样），但外面套了可替换的向量存储（demo 用内置
 *      'memory' provider，生产换 qdrant / pgvector——见 17-pgvector），
 *      检索是向量 + BM25 关键词的混合排序。
 *
 * mem0 只替换 Layer 3。Layer 1（WorkingMemory 模板 + 自更新工具）和
 * Layer 2（messages 表 append-only + rolling summary + 水位线）mem0 都
 * 不管——它的 run_id 只是给记忆条目打会话作用域标签，history API 只是
 * 记忆操作的审计日志，对话历史管理仍然归宿主（本文件原样保留 03 的实现）。
 *
 * ┌─ Layer 1: Working Memory（工作记忆）      —— 本地手写，与 03 相同
 * ├─ Layer 2: Episodic Memory（情景记忆）     —— 本地手写，与 03 相同
 * └─ Layer 3: Semantic Memory（语义记忆）     —— ★ 换成 mem0 ★
 *
 * 接入 mem0 的三个接线点（读写时机不变，仍是"读前注入、写后提炼"）：
 *   写 = 每轮结束后 add(本轮 user/assistant 两条消息, { userId })
 *   读 = 每次 LLM 调用前 search(当前输入, { userId, topK }) 注入 system prompt
 *   回看 = getAll({ userId })，对应 03 的 semanticMemory.all()
 * userId 就是 mem0 的 scope——同一 user_id 跨会话共享记忆，
 * 正好支撑 03 里"会话 B 仍然记得过敏"的验证。
 *
 * 接 Xinference 的三个工程细节（都替你踩过坑了）：
 *   - mem0 的 OpenAIEmbedder 显式传 encoding_format: 'float'，
 *     规避了 OpenAI SDK v6 默认 base64 + Xinference 静默返回 float 数组
 *     导致解码出全零向量的坑（03 手写 embed 时必须自己处理的那件事）
 *   - mem0 的 OpenAILLM 不支持 extra body，传不了 03 的
 *     chat_template_kwargs.enable_thinking=false。Qwen3 思考内容会被
 *     Xinference 放进 reasoning_content 字段，content 仍是干净的 JSON，
 *     只是提取调用更慢、更费 token
 *   - pnpm 安装后默认忽略 better-sqlite3 的构建脚本（mem0 的向量存储
 *     和历史库都依赖它），需要 pnpm rebuild better-sqlite3 一次
 *
 * 运行: npx tsx 19-mem0/index.ts
 */

import OpenAI from 'openai';
import { Memory } from 'mem0ai/oss';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };
/** 语义检索用的 embedding 模型（同一 Xinference 服务上部署） */
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'Qwen3-Embedding-8B';
/** 语义记忆的 scope——对应 03 里 db.insertSession('user-001') 的用户 */
const USER_ID = 'user-001';

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

// ---------------------------------------------------------------------------
// Layer 3: mem0 — 持久事实的提取、巩固与检索
//
// 一个 Memory 实例 = LLM（提取/巩固用）+ embedder（向量化）+ 向量存储。
// 三个组件都可以指向任意 OpenAI 兼容端点——这里全部指向本地 Xinference：
//
//   llm      → qwen3：跑"提取"和"巩固"两次 LLM 调用（add() 内部）
//   embedder → Qwen3-Embedding-8B：记忆写入时算一次向量，检索时算查询向量
//   vectorStore → 'memory' provider：内置 SQLite + 余弦相似度（生产换
//              qdrant/pgvector）。dbPath 用 ':memory:' 让每次运行从零开始，
//              和 03 的内存版 SemanticMemory 行为对齐；换成文件路径即可跨进程持久
//
// 维度不显式指定：构造时 mem0 会做一次探针 embedding 自适配（4096 维也好
// 768 维也好都能跑）。disableHistory 关掉 ~/.mem0/history.db 的记忆操作
// 审计日志（"何时 ADD/UPDATE/DELETE 了哪条"），demo 用不上。
// ---------------------------------------------------------------------------

const memory = new Memory({
  llm: {
    provider: 'openai',
    config: {
      model: MODEL,
      apiKey: process.env.OPENAI_API_KEY ?? 'local',
      baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
    },
  },
  embedder: {
    provider: 'openai',
    config: {
      model: EMBED_MODEL,
      apiKey: process.env.OPENAI_API_KEY ?? 'local',
      baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
    },
  },
  vectorStore: {
    provider: 'memory',
    config: { dbPath: ':memory:' },
  },
  disableHistory: true,
});

/**
 * 写入时机 ①：每轮对话结束后调用（对应 03 的 extractFromTurn）。
 * 把本轮的 user/assistant 消息整对交给 mem0——向量召回、提取、去重、
 * 落库都在 add() 内部完成（v3 是 ADD-only，返回的 metadata.event 恒为 ADD）。
 * 生产环境可以 fire-and-forget，不阻塞用户。
 */
async function extractFromTurn(userMessage: string, assistantMessage: string) {
  const { results } = await memory.add(
    [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantMessage },
    ],
    { userId: USER_ID },
  );
  for (const r of results) {
    console.log(`    💾 mem0 ${String(r.metadata?.event ?? 'ADD')}: "${r.memory}"`);
  }
}

/**
 * 读取时机 ①：每次 LLM 调用前，用当前用户输入检索相关事实（对应 03 的 retrieve）。
 * mem0 内部：embed(query) → 向量存储余弦相似度 top-k。03 的两种模式
 * （embedding / 关键词 fallback）在这里只剩一种——embedder 是必选组件。
 */
async function retrieve(query: string, topK = 3): Promise<string[]> {
  // 注意 scope 的两种写法：add() 直接收 { userId }，search/getAll 用 { filters: { user_id } }
  const { results } = await memory.search(query, { filters: { user_id: USER_ID }, topK });
  return results.map((r) => r.memory);
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
//
// （这一层 mem0 不提供——它的 run_id 只是记忆条目的作用域标签，history 只是
//   记忆操作审计日志。对话历史的存储/裁剪/压缩仍然是宿主的职责。）
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
  const relevantFacts = await retrieve(userMessage);
  // Layer 2 前置：先把"将被裁掉、且摘要未覆盖"的旧轮次增量并入 rolling summary
  const summary = await compactEpisodic(sessionId);
  const systemPrompt =
    '你是一个贴心的个人助理。\n\n' +
    // Layer 1: working memory 全量注入
    `## 用户档案（工作记忆）\n${workingMemory.content}\n` +
    // Layer 2: rolling summary 注入（本会话被裁掉的旧轮次的压缩要点）
    (summary ? `\n## 前情摘要（本会话更早的对话，已压缩为要点）\n${summary}\n` : '') +
    // Layer 3: mem0 检索 top-k 注入
    (relevantFacts.length
      ? `\n## 相关长期记忆\n${relevantFacts.map((f) => `- ${f}`).join('\n')}\n`
      : '');
  if (summary) console.log(`    📜 注入前情摘要: ${summary.replace(/\n/g, ' ⏎ ').slice(0, 80)}${summary.length > 80 ? '…' : ''}`);
  if (relevantFacts.length) console.log(`    🔍 mem0 检索到长期记忆: ${relevantFacts.join(' | ')}`);

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
      // ===== 写入时机 ②：这轮结束后，把本轮对话交给 mem0 提炼+巩固 =====
      // 生产环境可以 fire-and-forget，不阻塞用户
      await extractFromTurn(userMessage, msg.content ?? '');
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
// 演示：会话 A 两轮（验证 episodic 落库与读回）→ 新会话 B 验证跨会 mem0 记忆
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
  // 新会话的 episodic 层是空的，但 mem0 的记忆按 userId 跨会话共享 → 模型应该记得过敏
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

  console.log('\n========= 最终语义记忆库（mem0 getAll）=========');
  const { results } = await memory.getAll({ filters: { user_id: USER_ID } });
  for (const r of results) console.log(`- [${r.id}] ${r.memory}`);
}

main();
