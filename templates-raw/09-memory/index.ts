/**
 * ============================================================
 * 09 — 文件式分层记忆（Trae-style File Memory）
 * 对照场景: ~/.trae-cn/memory 的真实结构（无数据库，纯文件）
 * ============================================================
 *
 * 03 的 episodic 层用"模拟数据库"；这个例子换成 Trae 的真实做法：记忆直接
 * 落文件系统。为什么不用数据库？——因为消费方是 agent（ls/grep/read），
 * 不是 SQL。本地单用户、写入量小（一天几 KB）、访问模式就是"扫最近的 +
 * 关键词命中"，文件本身就是 API；加个 SQLite 只会多一层驱动代码，
 * 换不来任何能力。需要数据库的临界条件还是那几条：多用户并发、量大到
 * grep 慢、要向量检索、要事务。
 *
 * 存储结构（对照 ~/.trae-cn/memory/projects/<项目路径转义>）：
 *
 *   09-memory/memory/projects/demo-09-memory/
 *   ├── 20261027/                          ← 日期目录 = 时间分区，惰性创建
 *   │   ├── session_memory_<24位hex>.jsonl ← 每轮一行：写后提炼的轮级要点
 *   │   └── topics.md                      ← 每会话一条：主题摘要 + 钻取索引
 *   └── 20261028/
 *       └── …
 *
 *   日期目录为什么不连续？惰性创建——当天有会话才建，没聊就没有。
 *   作用 = 数据库按时间分区：① "看最近的"检索先 ls 日期即完成时间过滤
 *   ② TTL 清理 = 删旧目录 ③ 单目录文件不爆炸。
 *
 * 与 03 的最大区别：本地连 episodic 逐字原文都不存——每轮问答当场压成一行
 * 要点，原文只存在于当轮上下文里（Trae 的原文在服务端，本地只存提炼层）。
 * 代价：失去 03 强调的"append-only 换来的重算权"；收益：磁盘上永远是
 * 便宜的要点，永不膨胀。适合"要点足够"的场景（编码问答），需要逐字
 * 审计/重放的合规场景请回到 03 的数据库方案。
 *
 * jsonl 每行 schema（逐字段对照 ~/.trae-cn 真实产物逆向复刻；Trae 内部
 * 原始提示词未公开，可复刻的是产出的结构、格式与行为）：
 *   {"intent":"用户这轮意图","actions":["助手动作"],"outcome":"结果",
 *    "learned":["持久事实"],"message_summary_time":"…","message_id":"…"}
 *   （真实产物还带 compact_summary_meta{trigger:auto,mode:async,digest}，省略）
 *
 * topics.md 的关键认知：不是"摘要的摘要"流水线，而是有收录标准的选择性
 * 索引——实测同一天 3 个会话只有 1 个大主题会话被收录。格式与实测一致
 * （注意 ] 后无空格）：
 *   [session_id: 6a961eb2… | topic_summary_time: 2026-09-01 10:30:27]一段话摘要
 *
 * 读取 = 快查（quick pass），先粗后细，与 Trae agent 开场扫记忆同构：
 *   ① ls 最近 N 天日期目录（默认 2 天，天然时间过滤）
 *   ② 读其中所有 topics.md（几百 token 量级，便宜）
 *   ③ LLM 判断哪些历史会话与当前问题相关（结构化输出选 session_id，宁缺毋滥）
 *   ④ 顺着 session_id 钻取对应 jsonl 的轮级要点，注入 system prompt
 *   ⑤ 都不相关就什么都不注入（冷启动零额外成本）
 * 索引层和被索引层信息重复是特性不是 bug：换来检索成本从 O(总轮数) 降到
 * O(会话数)——先用 903B 判断"要不要读 11KB"，而不是每次全读。
 *
 * ⚠️ 本 demo 的记忆根目录是自己的 09-memory/memory/，绝不写 ~/.trae-cn。
 * 每次运行先清空重建，保证可重复演示。
 *
 * 运行: npx tsx 09-memory/index.ts
 */

import OpenAI from 'openai';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖（与 01-08 相同）
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };

// ---------------------------------------------------------------------------
// 存储层：MemoryStore — 纯文件实现，对照 ~/.trae-cn/memory 的目录语义
// 接真实使用时把根目录换成 ~/.trae-cn/memory 即可，方法签名不用动
// ---------------------------------------------------------------------------

/** 与 Trae 实测一致的 24 位 hex id（session/message 通用） */
const newId = () => randomBytes(12).toString('hex');
const pad = (n: number) => String(n).padStart(2, '0');
/** 日期目录名：YYYYMMDD（无连字符，与实测一致） */
const fmtDirName = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
/** 时间戳：YYYY-MM-DD HH:mm:ss（与实测一致） */
const fmtTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** jsonl 每行的 schema——逐字段对照 Trae 真实产物 */
interface TurnSummary {
  intent: string;
  actions: string[];
  outcome: string;
  learned: string[];
  message_summary_time: string;
  message_id: string;
}

/** topics.md 解析出的一条索引（粗层） */
interface TopicEntry {
  date: string; // YYYYMMDD
  sessionId: string;
  summary: string;
}

const MEMORY_ROOT = fileURLToPath(new URL('./memory', import.meta.url));

class MemoryStore {
  readonly projectDir = path.join(MEMORY_ROOT, 'projects', 'demo-09-memory');

  /** demo 专用：每次运行前清空，保证可重复演示 */
  async reset() {
    await fs.rm(this.projectDir, { recursive: true, force: true });
  }

  private dateDir(date: string) {
    return path.join(this.projectDir, date);
  }

  private sessionFile(date: string, sessionId: string) {
    return path.join(this.dateDir(date), `session_memory_${sessionId}.jsonl`);
  }

  private topicsFile(date: string) {
    return path.join(this.dateDir(date), 'topics.md');
  }

  // ===== 写入 =====

  /** 追加一轮要点：appendFile 一行 JSON（append-only，mkdir 惰性创建日期目录） */
  async appendTurn(date: string, sessionId: string, turn: TurnSummary) {
    await fs.mkdir(this.dateDir(date), { recursive: true });
    await fs.appendFile(this.sessionFile(date, sessionId), JSON.stringify(turn) + '\n', 'utf8');
    console.log(`💾 jsonl 追加: ${date}/session_memory_${sessionId}.jsonl ← "${turn.intent.slice(0, 30)}…"`);
  }

  /**
   * 收录/更新一条会话主题到 topics.md（同一 session 重写不重复）。
   * 行格式与实测一致：] 后无空格。全系统唯一的"覆盖式"写，也只覆盖自己那一行。
   */
  async upsertTopic(date: string, sessionId: string, summary: string, time: string) {
    await fs.mkdir(this.dateDir(date), { recursive: true });
    const file = this.topicsFile(date);
    let existing = '';
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch {
      /* 首次写入 */
    }
    const prefix = `[session_id: ${sessionId}`;
    const kept = existing.split('\n').filter((l) => l && !l.startsWith(prefix));
    kept.push(`[session_id: ${sessionId} | topic_summary_time: ${time}]${summary}`);
    await fs.writeFile(file, kept.join('\n') + '\n', 'utf8');
    console.log(`    📝 topics.md 收录: ${date}/topics.md ← 会话 ${sessionId}`);
  }

  // ===== 读取（快查的两级） =====

  /** ls 最近 N 天的日期目录（N=2 对应 Trae 快查"最近两天"的约定） */
  async listRecentDates(n: number): Promise<string[]> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.projectDir);
    } catch {
      return []; // 项目还没任何记忆（冷启动）
    }
    return entries.filter((d) => /^\d{8}$/.test(d)).sort().slice(-n);
  }

  /** 读粗层：解析最近几天的 topics.md → 索引条目（便宜，几百 token） */
  async readTopics(dates: string[]): Promise<TopicEntry[]> {
    const out: TopicEntry[] = [];
    for (const date of dates) {
      let raw = '';
      try {
        raw = await fs.readFile(this.topicsFile(date), 'utf8');
      } catch {
        continue;
      }
      for (const line of raw.split('\n').filter(Boolean)) {
        const m = line.match(/^\[session_id: (\S+) \| topic_summary_time: ([^\]]+)\](.*)$/);
        if (m) out.push({ date, sessionId: m[1], summary: m[3].trim() });
      }
    }
    return out;
  }

  /** 读细层：顺着 session_id 钻取 jsonl 的轮级要点 */
  async readTurns(date: string, sessionId: string): Promise<TurnSummary[]> {
    let raw = '';
    try {
      raw = await fs.readFile(this.sessionFile(date, sessionId), 'utf8');
    } catch {
      return [];
    }
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as TurnSummary);
  }

  /** 结尾展示用：列出项目的全部文件 */
  async listAll(): Promise<Array<{ date: string; files: Array<{ name: string; size: number }> }>> {
    const result: Array<{ date: string; files: Array<{ name: string; size: number }> }> = [];
    for (const date of await this.listRecentDates(9999)) {
      const files: Array<{ name: string; size: number }> = [];
      for (const name of await fs.readdir(this.dateDir(date))) {
        files.push({ name, size: (await fs.stat(path.join(this.dateDir(date), name))).size });
      }
      result.push({ date, files });
    }
    return result;
  }
}

const store = new MemoryStore();

// ---------------------------------------------------------------------------
// 写入时机：每轮结束 → 轮级要点（jsonl）；会话结束 → 主题收录（topics.md）
// 生产环境两者都应 fire-and-forget 异步执行（Trae 实测 meta: mode=async），
// demo 里 await 是为了输出顺序确定
// ---------------------------------------------------------------------------

/** 每轮写后提炼：intent/actions/outcome/learned，tool call 拿结构化输出 */
async function summarizeTurn(date: string, sessionId: string, userMessage: string, assistantMessage: string) {
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是会话记忆提炼器。把这一轮用户问答压缩成一行结构化记录，字段：' +
          'intent=用户这轮的意图（一句话）；actions=助手采取的关键动作（短语数组）；' +
          'outcome=这轮的最终结果（一句话）；learned=值得长期记住的事实或结论（字符串数组，没有则为空数组）。' +
          '只存要点，不存逐字原文。没有持久价值的字段给空值，不要编造。',
      },
      { role: 'user', content: `用户: ${userMessage}\n助手: ${assistantMessage}` },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'save_turn_summary',
          description: '保存这一轮的结构化记忆',
          parameters: {
            type: 'object',
            properties: {
              intent: { type: 'string', description: '用户这轮的意图（一句话）' },
              actions: { type: 'array', items: { type: 'string' }, description: '助手的关键动作（短语数组）' },
              outcome: { type: 'string', description: '这轮的最终结果（一句话）' },
              learned: { type: 'array', items: { type: 'string' }, description: '值得长期记住的事实/结论' },
            },
            required: ['intent', 'actions', 'outcome', 'learned'],
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'save_turn_summary' } },
    ...(extraBody ?? {}),
  });

  const raw = response.choices[0].message.tool_calls?.find((c) => c.type === 'function')?.function.arguments;
  if (!raw) return;
  const parsed = JSON.parse(raw) as { intent: string; actions: string[]; outcome: string; learned: string[] };
  await store.appendTurn(date, sessionId, {
    intent: parsed.intent,
    actions: parsed.actions ?? [],
    outcome: parsed.outcome,
    learned: parsed.learned ?? [],
    message_summary_time: fmtTime(new Date()),
    message_id: newId(),
  });
}

/**
 * 会话结束时的主题收录：选择性索引——不是"摘要的摘要"流水线。
 * 有跨会话回顾价值（排查问题/做决策/建立约定）才写 topics.md；
 * 寒暄、一次性简单问答不收录（对应实测：同一天 3 个会话只收录 1 个）。
 */
async function closeSession(date: string, sessionId: string) {
  const turns = await store.readTurns(date, sessionId);
  if (!turns.length) return;
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是会话主题归纳器。topics.md 是一张有收录标准的选择性索引：只收录有跨会话回顾价值的会话' +
          '（排查了问题、做了决策、建立了约定），寒暄和一次性简单问答不收录。' +
          '值得收录就输出一段话主题摘要（涵盖：用户是谁/干了什么/关键结论，可直接独立阅读）；' +
          '不值得就给空字符串。判断基于下面的轮级记录。',
      },
      {
        role: 'user',
        content: turns.map((t, i) => `第${i + 1}轮 意图: ${t.intent}｜结果: ${t.outcome}`).join('\n'),
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'save_topic',
          description: '收录会话主题到 topics.md',
          parameters: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: '主题摘要；无跨会话价值则为空字符串' },
            },
            required: ['summary'],
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'save_topic' } },
    ...(extraBody ?? {}),
  });

  const raw = response.choices[0].message.tool_calls?.find((c) => c.type === 'function')?.function.arguments;
  const summary = raw ? (JSON.parse(raw).summary as string).trim() : '';
  if (summary) {
    await store.upsertTopic(date, sessionId, summary, fmtTime(new Date()));
  } else {
    console.log(`    ⏭️ topics.md 跳过会话 ${sessionId}（无跨会话回顾价值，选择性收录）`);
  }
}

// ---------------------------------------------------------------------------
// 读取时机：快查 quick pass——先粗（topics.md）后细（jsonl 钻取）
// ---------------------------------------------------------------------------

/** 用 topics.md 索引判断相关性：LLM 结构化输出选出相关 session_id，宁缺毋滥 */
async function selectSessions(topics: TopicEntry[], query: string): Promise<string[]> {
  if (!topics.length) return [];
  const catalog = topics.map((t) => `[${t.date}] [session_id: ${t.sessionId}] ${t.summary}`).join('\n\n');
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是记忆检索器。下面是最近的会话主题索引（topics.md 内容）和用户当前的问题。' +
          '选出与当前问题相关的历史会话——只选能帮助回答当前问题的，宁缺毋滥；都不相关就返回空数组。',
      },
      { role: 'user', content: `会话主题索引:\n${catalog}\n\n当前问题: ${query}` },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'select_sessions',
          description: '选出与当前问题相关的历史会话',
          parameters: {
            type: 'object',
            properties: { session_ids: { type: 'array', items: { type: 'string' } } },
            required: ['session_ids'],
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'select_sessions' } },
    ...(extraBody ?? {}),
  });
  const raw = response.choices[0].message.tool_calls?.find((c) => c.type === 'function')?.function.arguments;
  return raw ? ((JSON.parse(raw).session_ids as string[]) ?? []) : [];
}

// ---------------------------------------------------------------------------
// chat：每轮 = 快查注入 → 回答 → 写后提炼。无工具循环（本例主题是记忆机制）
// ---------------------------------------------------------------------------

async function chat(sessionId: string, date: string, userMessage: string): Promise<string> {
  console.log(`\n📥 用户: ${userMessage}`);

  // ===== 快查：先粗后细 =====
  const dates = await store.listRecentDates(2); // ① ls 最近两天
  const topics = await store.readTopics(dates); // ② 读 topics.md
  let memoryBlock = '';
  if (topics.length) {
    const picked = await selectSessions(topics, userMessage); // ③ 判断相关性
    const relevant = topics.filter((t) => picked.includes(t.sessionId));
    if (relevant.length) {
      for (const t of relevant) {
        const turns = await store.readTurns(t.date, t.sessionId); // ④ 钻取 jsonl
        memoryBlock +=
          `\n## 相关历史记忆（${t.date} 的会话 ${t.sessionId}）\n主题: ${t.summary}\n` +
          turns
            .map((x) => `- 意图: ${x.intent}｜结论: ${x.outcome}${x.learned.length ? `｜要点: ${x.learned.join('；')}` : ''}`)
            .join('\n') +
          '\n';
        console.log(`    🔍 钻取到历史会话 ${t.sessionId}（${t.date}），注入 ${turns.length} 轮要点`);
      }
    } else {
      console.log('    （topics 未命中相关会话，不注入——宁缺毋滥）');
    }
  } else {
    console.log('    （最近无 topics.md，冷启动零记忆）');
  }

  // ===== 回答 =====
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: '你是一个 TypeScript 编程助手。\n' + memoryBlock },
      { role: 'user', content: userMessage },
    ],
    ...(extraBody ?? {}),
  });
  const answer = response.choices[0].message.content ?? '';
  console.log(`🤖 回复: ${answer}`);

  // ===== 写后提炼：每轮一行 jsonl =====
  await summarizeTurn(date, sessionId, userMessage, answer);
  return answer;
}

// ---------------------------------------------------------------------------
// 演示：昨天两个会话（一个实质性 + 一个寒暄，验证选择性收录）
// → 今天新会话靠 topics.md → jsonl 两级钻取回答"接着昨天的话题"
// → 最后打印文件树与全部产物
// ---------------------------------------------------------------------------

async function main() {
  await store.reset();
  const yesterday = fmtDirName(new Date(Date.now() - 86_400_000));
  const today = fmtDirName(new Date());

  console.log(`========= 会话 A（模拟昨天 ${yesterday}，实质性技术讨论）=========`);
  const sidA = newId();
  await chat(sidA, yesterday, 'TypeScript 的 satisfies 运算符是干什么的？和 as 有什么区别？');
  await chat(sidA, yesterday, 'tsconfig 里 strict 和 noUncheckedIndexedAccess 分别控制什么？');
  await closeSession(yesterday, sidA);

  console.log(`\n========= 会话 C（同在昨天，寒暄小会话——预期被 topics.md 跳过）=========`);
  const sidC = newId();
  await chat(sidC, yesterday, '在吗？随便问问，今天天气不错');
  await closeSession(yesterday, sidC);

  console.log(`\n========= 会话 B（今天 ${today}，全新 session——靠两级钻取续上昨天的话题）=========`);
  const sidB = newId();
  await chat(sidB, today, '接着昨天的话题：实际项目里 satisfies 和 as 该怎么选？给个例子');
  await chat(sidB, today, '再帮我把昨天聊的那两个 tsconfig 编译选项给个使用建议');
  await closeSession(today, sidB);

  // ===== 打印最终产物 =====
  console.log('\n========= 最终记忆产物（对照 ~/.trae-cn/memory 的结构）=========');
  for (const { date, files } of await store.listAll()) {
    console.log(`\n📁 ${date}/`);
    for (const f of files) console.log(`   - ${f.name} (${f.size} B)`);
    for (const f of files) {
      const raw = await fs.readFile(path.join(store.projectDir, date, f.name), 'utf8');
      console.log(`\n   ── ${date}/${f.name} ──`);
      if (f.name.endsWith('.jsonl')) {
        for (const line of raw.split('\n').filter(Boolean)) {
          const t = JSON.parse(line) as TurnSummary;
          console.log(`   ▸ intent: ${t.intent}`);
          console.log(`     actions: ${t.actions.join(' / ') || '（无）'}`);
          console.log(`     outcome: ${t.outcome}`);
          if (t.learned.length) console.log(`     learned: ${t.learned.join('；')}`);
        }
      } else {
        for (const line of raw.split('\n').filter(Boolean))
          console.log(`   ${line.slice(0, 100)}${line.length > 100 ? '…' : ''}`);
      }
    }
  }
}

main();
