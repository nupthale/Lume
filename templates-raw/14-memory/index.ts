/**
 * ============================================================
 * 14 — 生产级压缩时机（预算 · 切点 · 水位线 · 三时机）
 * 对照场景: Claude Code auto-compact / Trae 压缩切换 / Mastra Memory 裁剪处理器
 * ============================================================
 *
 * 03 是教学版：EPISODIC_LIMIT 写死 3，每轮都触发压缩——为了肉眼看见机制。
 * 本例是生产版：压缩由 token 预算驱动，绝大多数轮次零压缩、水位线纹丝不动。
 *
 * 【三时机口诀——整个例子的骨架，也是唯一需要背的东西】
 *   提问时     → 只 append 落库，水位线不动（零计算、零 LLM 调用）
 *   回答前     → 按预算算切点 → "水位线→切点"之间露出空档就增量压缩、
 *               水位线追平到切点前一条 → 发送 [system+摘要] + 逐字窗口
 *   回答完成后 → 只 append 落库，水位线不动
 *
 * 【三个位置概念：一个范围、两个点】
 *   逐字窗口 = 切点 → 最新消息 之间"原文照发"的一段（范围，每轮向后滑）
 *   切点     = 逐字窗口的左边界，每次回答前按预算现算（每轮可变、临时值）
 *   水位线   = 已压进摘要的位置，持久化在 sessions 表（单调前移、永不后退）
 *   压缩这个动作 = 把水位线追平到"切点 − 1"；其余时刻谁都不动。
 *
 * 【预算公式（触发线是预算，不是窗口）】
 *   逐字预算 = 窗口 × 触发比例 − 输出预留 − 压缩预留 − system/工具估算
 *   本服务实测窗口 40960（README 坑备忘）→ 40960×0.7 − 1024 − 1024 − ~500 ≈ 26000
 *   等真到窗口上限再压就晚了：压缩本身是一次 LLM 调用，最满的时刻它也得装得下。
 *
 * 【两条不变量（违反任何一条都会出事故）】
 *   ① 同一条消息绝不在摘要和逐字窗口里同时出现（水位线保证，零成本）
 *   ② 切点必须落在轮次边界（user 行）——切开问答对模型迷惑，
 *      切开 tool_call↔tool 结果配对协议直接 400（03 的教训）
 *   附带不变量③：存储层 append-only，裁剪只发生在读取组装，messages 永不删改
 *
 * 【估算 vs 校准】
 *   事前用本地估算决定切点（生产用 tiktoken / 服务端 tokenizer）；
 *   事后拿每次响应的 usage.prompt_tokens 对账，误差漂移大了就重新校准。
 *   本例每轮同时打印两个数——亲眼看看估算误差有多大。
 *
 * 【demo 为什么分两档预算】
 *   生产预算恒定，触发由"预算 − 已用"随历史增长逼近 0 驱动；
 *   demo 把预算直接调小 = 同一件事的快进（数学等价），免得真聊 26000 token。
 *
 * 运行: npx tsx 14-memory/index.ts
 * 可选: BUDGET_1=3000 BUDGET_2=220   两阶段预算（token），调小看压缩更早触发
 */

import OpenAI from 'openai';
import { getEncoding } from 'js-tiktoken';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖（与 01-13 相同）
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };

/** 本服务实测窗口上限（README 坑备忘）。demo 只用它推导展示，实际触发用小预算 */
const WINDOW_TOKENS = 40_960;
const OUTPUT_RESERVE = 1_024; // max_tokens：输出配额从窗口里扣
const COMPRESS_RESERVE = 1_024; // 给压缩调用本身留的空间——最满的时刻它得装得下
const TRIGGER_RATIO = 0.7;

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

// ---------------------------------------------------------------------------
// token 估算三级火箭（生产演进路径，本例真实走过前两级）：
//   ① 字符启发式（1 汉字 ≈ 1.2 token）：零依赖但糙——实测高估 31%~47%
//   ② 真 BPE 分词器 tiktoken：分词逻辑是真的，本地数、零网络调用。
//      用 OpenAI 官方纯 JS 移植 js-tiktoken（无 WASM）。注意：它的词表是
//      OpenAI 系的 o200k_base，不是 Qwen3 的词表 → 数字仍不等于服务端真实值
//   ③ 服务端 usage 对账：每轮打印"估算 vs 实际"，漂移大了就换分词器/校准系数。
//      要精确匹配 Qwen3，需要用 Qwen 自己的 tokenizer.json（transformers.js 加载）
// 事前要数（切点计算等不起网络往返），事后要对账（usage 是唯一真相）——
// 这两句话就是生产环境 token 计数的全部。
// ---------------------------------------------------------------------------

const encoding = getEncoding('o200k_base'); // OpenAI 最新词表；Qwen3 误差见每轮日志

function estimateTokens(text: string): number {
  if (!text) return 0;
  return encoding.encode(text).length;
}

/** 一条协议消息 ≈ 内容 token + 4 token 的 role/结构开销 */
function messageTokens(content: string): number {
  return estimateTokens(content) + 4;
}

// ---------------------------------------------------------------------------
// MockDB：sessions + messages 两张表（03 同款 schema，去掉本例用不到的列）
// messages append-only：裁剪只发生在"读取组装"，存储层永不删改
//
//   CREATE TABLE sessions (
//     id                  TEXT PRIMARY KEY,
//     summary             TEXT,              -- rolling summary：水位线之前的压缩要点
//     summarized_until_id BIGINT DEFAULT 0,  -- 水位线：messages.id <= 此值的行已被摘要覆盖
//   );
//   CREATE TABLE messages (               -- append-only，一条消息一行
//     id BIGSERIAL PRIMARY KEY, session_id TEXT, role TEXT, content TEXT
//   );
// ---------------------------------------------------------------------------

interface MessageRow {
  id: number;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface SessionRow {
  id: string;
  summary: string | null; // rolling summary（null = 还没有需要压缩的历史）
  summarized_until_id: number; // 水位线：<= 此 id 的行已被摘要覆盖
}

/** 模拟数据库：接口语义与 SQL 一致，接真实库时把这个类换成 pg/mysql 驱动实现 */
class MockDB {
  private sessions = new Map<string, SessionRow>();
  private rows: MessageRow[] = [];
  private nextId = 1;

  insertSession(): string {
    const id = 'session-1';
    this.sessions.set(id, { id, summary: null, summarized_until_id: 0 });
    return id;
  }

  getSession(id: string): SessionRow {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`session ${id} 不存在`);
    return { ...s };
  }

  /** UPDATE sessions SET summary=?, summarized_until_id=? —— 全系统唯一的非 append 写入 */
  updateSessionSummary(id: string, summary: string, summarizedUntilId: number) {
    const s = this.sessions.get(id)!;
    s.summary = summary;
    s.summarized_until_id = summarizedUntilId;
  }

  /** INSERT INTO messages ... —— append-only，一条消息一行，永不 UPDATE/DELETE */
  insertMessage(row: Omit<MessageRow, 'id' | 'created_at'>): number {
    const id = this.nextId++;
    this.rows.push({ ...row, id, created_at: new Date().toISOString() });
    return id;
  }

  /** SELECT * FROM messages WHERE session_id=? ORDER BY id —— 全量回看，永不裁剪 */
  getHistory(sessionId: string): MessageRow[] {
    return this.rows.filter((m) => m.session_id === sessionId);
  }
}

const db = new MockDB();

// ---------------------------------------------------------------------------
// 切点计算：从最新往回装 token，装到预算线；再回退对齐到轮次边界（user 行）
// 不变量②在这里结构化保证：窗口永远从 user 行开始 → 问答对/tool 配对天然完整
// ---------------------------------------------------------------------------

/** 切点计算的输入行。tokens 可显式指定（自检用确定性数字），缺省按内容估算 */
interface CutRow {
  id: number;
  role: string;
  content: string;
  tokens?: number;
}

interface CutResult {
  /** 原始切点（纯 token 装填停下的位置，可能落在配对中间——非法） */
  rawKeptFrom: number;
  /** 合法切点（回退到轮次边界后的位置，rows[keptFrom] 一定是 user 行） */
  keptFrom: number;
  /** 回退的行数：>0 说明原始切点切进了轮次中间 */
  backedOff: number;
}

function rowCost(r: CutRow): number {
  return r.tokens ?? messageTokens(r.content);
}

/**
 * rows = 候选逐字窗口（水位线之后的全部消息，含刚落库的新问题）。
 * 返回的 keptFrom=0 表示全部装得下（gap 为空 → 零压缩）。
 * 注意"宁可略超、不切配对"：回退会让窗口比预算多装几行——
 * 超一点只是贵几 token，切配对是协议事故。
 */
function computeCut(rows: CutRow[], verbatimBudget: number): CutResult {
  let acc = 0;
  let i = rows.length; // rows[i..] = 已从尾部装下的部分
  while (i > 0) {
    const t = rowCost(rows[i - 1]);
    if (acc + t > verbatimBudget) break;
    acc += t;
    i--;
  }
  // 至少保留最后一条：刚落库的新问题没有压缩去处，必须原样发
  const raw = Math.min(i, rows.length - 1);
  // 回退对齐轮次边界：窗口起点必须是 user 行
  let keptFrom = raw;
  while (keptFrom > 0 && rows[keptFrom].role !== 'user') keptFrom--;
  return { rawKeptFrom: raw, keptFrom, backedOff: raw - keptFrom };
}

/** 不变量②验证：tool 结果必须紧跟发起它的 assistant(tool_calls)，绝不能被窗口边界分开 */
function pairingIntact(kept: CutRow[]): boolean {
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].role === 'tool' && (i === 0 || kept[i - 1].role !== 'assistant')) return false;
    if (kept[i].role === 'assistant' && kept[i].content.startsWith('[发起') && kept[i + 1]?.role !== 'tool') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 自检：切点回退规则的确定性验证（纯本地、零 LLM 成本）
// 构造两轮带 tool 交换的对话，把预算卡在"原始切点恰好切进 tool 配对"的位置
// ---------------------------------------------------------------------------

function selfCheck() {
  console.log('========= 自检：切点回退规则（纯本地，零 LLM 成本）=========');
  const rows: CutRow[] = [
    { id: 1, role: 'user', content: '查一下北京今天的天气', tokens: 10 },
    { id: 2, role: 'assistant', content: '[发起 tool_call get_weather(北京)]', tokens: 15 },
    { id: 3, role: 'tool', content: '{"temp": 12}', tokens: 10 },
    { id: 4, role: 'assistant', content: '北京今天 12 度', tokens: 12 },
    { id: 5, role: 'user', content: '上海呢？', tokens: 8 },
    { id: 6, role: 'assistant', content: '[发起 tool_call get_weather(上海)]', tokens: 15 },
    { id: 7, role: 'tool', content: '{"temp": 15}', tokens: 10 },
    { id: 8, role: 'assistant', content: '上海 15 度', tokens: 12 },
    { id: 9, role: 'user', content: '两地相差多少度？', tokens: 10 },
  ];
  const budget = 35;
  const cut = computeCut(rows, budget);

  const filled = rows.slice(cut.rawKeptFrom).map((r) => `#${r.id}(${rowCost(r)})`);
  const overflow = rows[cut.rawKeptFrom - 1];
  console.log(`候选 9 行，逐字预算 ${budget}：从最新往回装 ${filled.join(' → ')}（累计 ${rows.slice(cut.rawKeptFrom).reduce((s, r) => s + rowCost(r), 0)}）`);
  console.log(`再装 #${overflow.id}(${rowCost(overflow)}) → 超线，停在 #${rows[cut.rawKeptFrom].id} [${rows[cut.rawKeptFrom].role}]`);
  console.log(`↑ 原始切点恰好切在 tool 配对中间：#6 发起的调用在窗口外、结果 #7 在窗口内 → 协议直接 400`);
  for (let k = cut.rawKeptFrom; k > cut.keptFrom; k--) {
    console.log(`  回退 → #${rows[k - 1].id} [${rows[k - 1].role}]${rows[k - 1].role === 'user' ? ' ✓ 轮次边界' : ' 仍非法'}`);
  }
  const kept = rows.slice(cut.keptFrom);
  console.log(`合法切点 #${kept[0].id} [user]，逐字窗口 #${kept[0].id}→#${kept[kept.length - 1].id}，配对校验: ${pairingIntact(kept) ? '✓ 完整' : '✗ 破损'}`);
  console.log('结论：切点先按 token 装填、再回退到轮次边界——宁可略超预算，绝不切开配对。\n');
}

// ---------------------------------------------------------------------------
// 增量压缩（时机②的核心动作）：把"水位线 → 切点"之间的空档并进 rolling summary
// 摘要做"合并"而非"追加"：LLM 去重、合并同主题、淘汰过时要点 → 摘要近似恒定大小
// ---------------------------------------------------------------------------

const stats = {
  compactionCalls: 0,
  compactionTokens: 0, // 压缩调用自身的真实开销（从 usage 取）
  rounds: [] as {
    n: number;
    budget: number;
    watermarkBefore: number;
    watermarkAfter: number;
    compressedRows: number;
    keptFromId: number;
    keptCount: number;
    backedOff: number;
    est: number;
    actual: number | undefined;
  }[],
};

async function compactGap(sessionId: string, session: SessionRow, gap: MessageRow[]): Promise<string> {
  const transcript = gap
    .map((r) => `${r.role === 'user' ? '用户' : '助手'}: ${r.content.replace(/\n/g, ' ').slice(0, 200)}`)
    .join('\n');
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是对话摘要器。把【已有摘要】与【新增对话】合并成一份最新的要点列表（每行一条，以 "- " 开头）。' +
          '【已有摘要】中仍然有效的要点必须全部保留——尤其用户姓名、目标、偏好等关键事实，一条都不许丢；' +
          '再从【新增对话】补充新信息、合并同主题、淘汰已被更新取代的旧要点。' +
          '丢弃寒暄和只对当时有意义的内容。直接输出列表，不要任何多余文字。',
      },
      { role: 'user', content: `【已有摘要】\n${session.summary || '（无）'}\n\n【新增对话】\n${transcript}` },
    ],
    max_tokens: 400,
    ...(extraBody ?? {}),
  });
  const merged = (response.choices[0].message.content ?? '').trim();
  const newWatermark = gap[gap.length - 1].id;
  db.updateSessionSummary(sessionId, merged, newWatermark);
  stats.compactionCalls += 1;
  stats.compactionTokens += (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);
  console.log(
    `    🗜️ 增量压缩: 并入 #${gap[0].id}~#${newWatermark}（${gap.length} 行），水位线 #${session.summarized_until_id || 0} → #${newWatermark}` +
      `（压缩调用自身 ${response.usage?.prompt_tokens ?? '?'}+${response.usage?.completion_tokens ?? '?'} tokens）`,
  );
  return merged;
}

// ---------------------------------------------------------------------------
// 时机②：回答前的组装。预算 → 切点 → 空档压缩（水位线追平）→ 发送
// ---------------------------------------------------------------------------

const BASE_SYSTEM = '你是简洁的中文健身助手，每个回答不超过两句话。';

function buildSystem(summary: string): string {
  return BASE_SYSTEM + (summary ? `\n\n## 前情摘要（更早的对话已压缩为要点）\n${summary}` : '');
}

async function answer(sessionId: string, budget: number) {
  const session = db.getSession(sessionId);
  const afterWatermark = db.getHistory(sessionId).filter((r) => r.id > session.summarized_until_id);

  // system（含现摘要）先占掉一块预算，剩下的给逐字窗口。
  // 压缩后摘要会变长一点，这里不重算——差几个 token，注释里诚实记录这个近似
  const systemCost = messageTokens(buildSystem(session.summary ?? '')) + 8;
  const cut = computeCut(afterWatermark, Math.max(budget - systemCost, 1));
  const kept = afterWatermark.slice(cut.keptFrom);
  const gap = afterWatermark.slice(0, cut.keptFrom); // 水位线之后、切点之前 = 本轮露出的空档

  // 空档非空才花这一次压缩调用；空了就零 LLM 成本——生产里绝大多数轮走这条路
  let summary = session.summary ?? '';
  if (gap.length) summary = await compactGap(sessionId, session, gap);

  const context: Messages = [
    { role: 'system', content: buildSystem(summary) },
    ...kept.map((r) => ({ role: r.role, content: r.content }) as Messages[number]),
  ];
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: context,
    max_tokens: 512,
    ...(extraBody ?? {}),
  });
  return {
    reply: response.choices[0].message.content ?? '',
    actual: response.usage?.prompt_tokens,
    est: context.reduce((s, m) => s + messageTokens(typeof m.content === 'string' ? m.content : ''), 0),
    cut,
    kept,
    rawKeptFromId: afterWatermark[cut.rawKeptFrom].id,
    gapCount: gap.length,
    systemText: buildSystem(summary),
  };
}

// ---------------------------------------------------------------------------
// 一轮对话 = 三个时机按序执行。整个文件唯一需要记住的就是这三段注释
// ---------------------------------------------------------------------------

async function turn(sessionId: string, text: string, budget: number, n: number, expect?: RegExp) {
  console.log(`\n—— 第 ${n} 轮（预算 ${budget} token）——`);
  console.log(`📥 用户: ${text}`);
  const watermarkBefore = db.getSession(sessionId).summarized_until_id;

  // ===== 时机① 提问时：只 append 落库，水位线不动（零计算、零 LLM 调用）=====
  const questionId = db.insertMessage({ session_id: sessionId, role: 'user', content: text });

  // ===== 时机② 回答前：算切点 → 有空档就增量压缩（水位线追平）→ 发送 =====
  const r = await answer(sessionId, budget);
  console.log(
    `   切点 #${r.kept[0].id}（原始 #${r.rawKeptFromId}${r.cut.backedOff ? `，回退 ${r.cut.backedOff} 行对齐轮次边界` : ''}）` +
      ` | 逐字窗口 #${r.kept[0].id}→#${questionId}（${r.kept.length} 行）` +
      ` | 水位线 #${watermarkBefore} → #${db.getSession(sessionId).summarized_until_id}${r.gapCount ? '' : '（不动）'}`,
  );
  console.log(
    `   事前估算 ${r.est} vs 实际 ${r.actual ?? '?'} prompt tokens` +
      (r.actual ? `（误差 ${(((r.actual - r.est) / r.actual) * 100).toFixed(0)}%）` : '') +
      (r.gapCount ? '' : ' —— 预算内，零压缩调用'),
  );
  // 第 4 轮（阶段二首次触发）展示模型实际看到的 system：摘要 + 逐字窗口的组装现场
  if (n === 4) {
    console.log(`   📋 模型本轮实际看到的 system prompt:`);
    console.log(r.systemText.split('\n').map((l) => `      ${l}`).join('\n'));
  }

  // ===== 时机③ 回答完成后：只 append 落库，水位线不动 =====
  db.insertMessage({ session_id: sessionId, role: 'assistant', content: r.reply });
  console.log(`🤖 助手: ${r.reply.trim()}`);
  if (expect) {
    const ok = expect.test(r.reply);
    console.log(`   ${ok ? '✓' : '✗'} 召回校验: ${ok ? '信息来自前情摘要——逐字窗口里早没有第 1 轮了' : '期望 ' + expect + ' 未命中'}`);
  }

  const s = db.getSession(sessionId);
  stats.rounds.push({
    n,
    budget,
    watermarkBefore,
    watermarkAfter: s.summarized_until_id,
    compressedRows: r.gapCount,
    keptFromId: r.kept[0].id,
    keptCount: r.kept.length,
    backedOff: r.cut.backedOff,
    est: r.est,
    actual: r.actual,
  });
}

// ---------------------------------------------------------------------------
// 演示主线：阶段一（预算充足，验证"大多数轮零压缩"）→ 阶段二（预算收紧，
// 每轮露出小空档、增量压缩、水位线小步前移）→ 召回验证（信息只存在于摘要里）
// ---------------------------------------------------------------------------

async function main() {
  const B1 = Number(process.env.BUDGET_1) || 3000;
  const B2 = Number(process.env.BUDGET_2) || 220;

  // 生产预算推导展示（本服务实测窗口 40960）
  const prodBudget = Math.round(WINDOW_TOKENS * TRIGGER_RATIO - OUTPUT_RESERVE - COMPRESS_RESERVE - 500);
  console.log(`生产预算推导: ${WINDOW_TOKENS} × ${TRIGGER_RATIO} − ${OUTPUT_RESERVE}(输出预留) − ${COMPRESS_RESERVE}(压缩预留) − ~500(system/工具) ≈ ${prodBudget} token`);
  console.log(`demo 预算: 阶段一 ${B1} / 阶段二 ${B2}（调小预算 = 快进"历史逼近预算"的稳态）\n`);

  selfCheck();

  const sessionId = db.insertSession();

  console.log('========= 阶段一：预算充足（模拟会话早期——历史远未触线）=========');
  await turn(sessionId, '我叫小李，正在增肌，目标每天吃 150 克蛋白质。', B1, 1);
  await turn(sessionId, '我早饭吃了 4 个鸡蛋加一杯牛奶，蛋白质够不够？', B1, 2);
  await turn(sessionId, '增肌期每天大概要喝多少升水？', B1, 3);

  console.log('\n========= 阶段二：预算收紧（模拟长会话稳态——每轮露出小空档）=========');
  await turn(sessionId, '我刚练完腿，练后这顿主食吃什么好？', B2, 4);
  await turn(sessionId, '那这顿的蛋白质怎么安排？', B2, 5);
  await turn(sessionId, '明天是休息日，饮食要调整吗？', B2, 6);

  console.log('\n========= 阶段三：召回验证（名字和目标只存在于摘要里）=========');
  await turn(sessionId, '直接回答：我叫什么名字？每天的蛋白质目标是多少克？', B2, 7, /小李/);

  report(sessionId);
}

// ---------------------------------------------------------------------------
// 报告：水位线轨迹 + 不变量验证 + 成本账 + 存储完整性
// ---------------------------------------------------------------------------

function report(sessionId: string) {
  console.log('\n========= 水位线轨迹（所有动作都发生在"答前"那一瞬）=========');
  console.log('  轮 |  预算 | 压缩行数 | 水位线     | 逐字窗口 | 实际 prompt');
  for (const r of stats.rounds) {
    console.log(
      `  ${String(r.n).padStart(2)} | ${String(r.budget).padStart(5)} | ${String(r.compressedRows).padStart(5)}   | ` +
        `#${String(r.watermarkBefore).padStart(2)} → #${String(r.watermarkAfter).padStart(2)} | ` +
        `${String(r.keptCount).padStart(3)} 行   | ${r.actual ?? '?'}`,
    );
  }

  console.log('\n========= 不变量验证 =========');
  const noOverlap = stats.rounds.every((r) => r.keptFromId > r.watermarkAfter);
  console.log(`  ① 摘要与逐字窗口无重叠（逐字窗口起点 > 水位线）: ${noOverlap ? '✓ 全部成立' : '✗ 违反'}`);
  const rows = db.getHistory(sessionId);
  const legalStart = stats.rounds.every((r) => rows.find((x) => x.id === r.keptFromId)?.role === 'user');
  console.log(`  ② 逐字窗口起点全部落在轮次边界（user 行）: ${legalStart ? '✓ 全部成立' : '✗ 违反'}`);
  const monotonic = stats.rounds.every((r, i, a) => i === 0 || r.watermarkAfter >= a[i - 1].watermarkAfter);
  console.log(`  ③ 水位线单调前移、永不后退: ${monotonic ? '✓ 全程成立' : '✗ 违反'}`);
  const idsOk = rows.every((r, i) => i === 0 || r.id === rows[i - 1].id + 1);
  console.log(`  ④ 存储层 append-only（${rows.length} 行、id 连续无删改）: ${rows.length === stats.rounds.length * 2 && idsOk ? '✓ 模型只见裁剪视图，回看永远全量' : '✗ 违反'}`);

  console.log('\n========= 诚实的成本账（demo vs 生产）=========');
  console.log(`  压缩调用 ${stats.compactionCalls} 次，自身开销 ${stats.compactionTokens} tokens（真实 usage）`);
  const last = stats.rounds[stats.rounds.length - 1];
  const fullEst = db.getHistory(sessionId).reduce((s, r) => s + messageTokens(r.content), 0) + messageTokens(buildSystem(db.getSession(sessionId).summary ?? ''));
  console.log(`  第 ${last.n} 轮实际 prompt ${last.actual} tokens；若不压缩发全量 ≈ ${fullEst}（估算）`);
  console.log('  demo 历史短，这笔账未必为正——压缩调用可能比省下的还贵（13 的结论）。');
  console.log('  生产稳态（历史 ≈ 预算上限）里每次压缩省的是"整段逐字历史 − 一小段摘要"，');
  console.log('  远大于压缩调用本身——所以触发时机才是"接近预算才压"，而不是每轮都压。');

  console.log('\n========= 存储完整性回看（模型只见裁剪视图，回看永远全量）=========');
  for (const r of rows) {
    const text = r.content.replace(/\n/g, ' ');
    console.log(`- #${r.id} [${r.role}] ${text.length > 50 ? text.slice(0, 50) + '…' : text}`);
  }
  const s = db.getSession(sessionId);
  console.log(`\n========= 最终 rolling summary（水位线 #${s.summarized_until_id} 之前的全部历史都在这）=========`);
  console.log(s.summary ?? '（无）');
}

main();
