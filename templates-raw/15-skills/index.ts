/**
 * ============================================================
 * 15 — Agent Skills：把「知识型能力」打包成按需加载的提示词包
 * 对照场景: Claude Code / Trae 的 Skill 系统（你正在用的这个环境就装着一堆）
 * ============================================================
 *
 * 核心认知：skill 不是 function calling，也不是什么新协议，
 * 就是一个文件夹：
 *
 *   skills/ascii-table/
 *     SKILL.md          ← YAML frontmatter(name+description) + 指令正文
 *     scripts/align.py  ← 附属脚本，被正文按需引用
 *
 * 它解决的问题是【上下文经济学】：
 *   模型的"知识型能力"（规范、流程、领域 know-how）一旦写进 system
 *   prompt，每轮调用都要付费。装 10 个 skill、每个正文 2000 tokens，
 *   = 每轮白烧 2 万 tokens，而其中 9 个与当前任务无关。
 *
 * 解法 = 渐进式披露（progressive disclosure），三层：
 *   第 1 层【常驻】启动时只把每个技能的 name + description 注入
 *              system prompt，每个约几十 tokens——这是"技能目录"
 *   第 2 层【按需】模型判断任务与某技能相关 → 调 load_skill(name)
 *              工具 → 该 SKILL.md 全文进入上下文
 *   第 3 层【按需】正文里引用的脚本/参考文件，模型用 run_command
 *              等基础工具自己取用（06 的通用工具集）
 *
 * 与 03（记忆）的分界：记忆回答"这个用户/项目发生过什么"（运行时
 * 数据）；skill 回答"这类任务该怎么做"（预置知识，人写好的）。
 * 与 06（工具集）的分界：工具是"手"（代码执行）；skill 是"脑子里的
 * 说明书"（提示词注入）。两者经常配合：load 完 skill 再用工具干活。
 *
 * 本例演示：
 *   ① 对照实验——同一个中英混排表格任务，不带 skill 时模型手搓
 *      对齐（几乎必歪），带 skill 时命中 → load → 调脚本 → 完美对齐
 *   ② 第二次命中——SVG 图表任务，纯指令型 skill（无脚本），
 *      说明 skill 的主体就是"写得好的一份指令"
 *   ③ 内嵌代码型 skill——SKILL.md 里直接带一段 JS：模型把它经
 *      write_file 中转落盘、再 run_command 用 node 执行。看清一个
 *      关键事实：模型从不"执行"代码，它只是文本中继，执行永远发生
 *      在工具层（跑 TS 就把 node 换成 tsx；run_command 白名单决定
 *      什么能被执行）
 *   ④ token 结算——四个技能常驻全文 vs 渐进式披露的成本对比
 *
 * 运行: npx tsx 15-skills/index.ts
 */

import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getEncoding } from 'js-tiktoken';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };

const SKILLS_DIR = path.join(import.meta.dirname, 'skills');
const OUTPUT_DIR = path.join(import.meta.dirname, 'output');
const MAX_STEPS = 8;
const execAsync = promisify(exec);

// token 记账：js-tiktoken o200k_base（14 例实测：对 Qwen3 中文系统性
// 偏低约 5-6%，做成本对比够用，绝对值以服务端 usage 为准）
const encoding = getEncoding('o200k_base');
const countTokens = (s: string) => encoding.encode(s).length;

// ---------------------------------------------------------------------------
// SkillLoader：扫描 + 解析 frontmatter + 目录注入 + 按需加载
// 这 ~60 行就是 Claude Code / Trae Skill 系统的骨架
// ---------------------------------------------------------------------------

interface Skill {
  name: string;
  description: string;
  dir: string; // 技能文件夹路径（附属脚本相对它解析）
  body: string; // 指令正文（frontmatter 之后的部分）
  fullPathTokens: number; // 全文 token 数（frontmatter + 正文）
}

/** 手写解析 YAML frontmatter：只支持 name/description 单行（教学够用，不用 gray-matter） */
function parseFrontmatter(raw: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error('SKILL.md 缺少 frontmatter（--- 包裹的 name/description）');
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.name || !meta.description) throw new Error('frontmatter 缺 name 或 description');
  return { name: meta.name, description: meta.description, body: m[2].trim() };
}

/** 扫描 skills/ 下所有 <name>/SKILL.md。description 写得好坏直接决定命中率 */
async function scanSkills(): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const entry of await fs.readdir(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const raw = await fs.readFile(path.join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf-8');
    const { name, description, body } = parseFrontmatter(raw);
    skills.push({
      name,
      description,
      dir: path.join(SKILLS_DIR, entry.name),
      body,
      fullPathTokens: countTokens(raw),
    });
  }
  return skills;
}

/**
 * 第 1 层披露：技能目录。只有 name + description 常驻 system prompt。
 * 模型据此判断"要不要展开某个技能"——所以 description 是 skill 的
 * 命中率开关：写清"什么时候用"比写"这是什么"重要得多。
 */
function renderManifest(skills: Skill[]): string {
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return [
    '# 可用技能（skills）',
    '',
    '下面只列出技能名和描述。判断当前任务与某技能相关时，先调用 load_skill',
    '获取完整指令，再严格按指令执行；与任务无关的技能不要加载。',
    '',
    ...lines,
  ].join('\n');
}

/** 第 2 层披露：load_skill 工具的实现——读全文 */
async function loadSkill(skills: Skill[], name: string): Promise<unknown> {
  const skill = skills.find((s) => s.name === name);
  if (!skill) {
    return { error: `unknown skill: ${name}（可用: ${skills.map((s) => s.name).join(', ')}）` };
  }
  const full = await fs.readFile(path.join(skill.dir, 'SKILL.md'), 'utf-8');
  console.log(`  📖 渐进式披露第 2 层：加载 ${name} 全文（${countTokens(full)} tokens）`);
  return { skill: name, instructions: full };
}

// ---------------------------------------------------------------------------
// 基础工具：run_command（第 3 层披露的入口）+ write_file（产物落盘）
// 安全模型同 06：白名单 + 路径限制，"模型提议，代码否决"
// ---------------------------------------------------------------------------

const CMD_ALLOWLIST = new Set(['python3', 'node']);

async function runCommand(args: any): Promise<unknown> {
  const cmd = String(args.command ?? '').trim();
  if (!cmd) return { error: 'empty command' };
  if (!CMD_ALLOWLIST.has(cmd.split(/\s+/)[0])) {
    return { error: `command not in allowlist: ${cmd.split(/\s+/)[0]}（白名单: ${[...CMD_ALLOWLIST].join(' ')}）` };
  }
  try {
    // cwd = 本例根目录，skill 正文里的相对路径（skills/xxx/scripts/...）据此解析
    const { stdout } = await execAsync(cmd, { cwd: import.meta.dirname, timeout: 15_000, maxBuffer: 1_000_000 });
    return { command: cmd, stdout: stdout.slice(0, 4000) };
  } catch (err: any) {
    return { command: cmd, error: err.message?.slice(0, 500) };
  }
}

async function writeFile(args: any): Promise<unknown> {
  // .svg = 产物；.mjs = skill 内嵌代码中转落盘（实验 D）
  if (typeof args.path !== 'string' || !/^[\w.-]+\.(svg|mjs)$/.test(path.basename(args.path))) {
    return { error: '只允许写 output/ 下的 .svg / .mjs 文件' };
  }
  const p = path.join(OUTPUT_DIR, path.basename(args.path));
  await fs.writeFile(p, String(args.content ?? ''), 'utf-8');
  return { ok: true, path: `output/${path.basename(args.path)}`, bytes: String(args.content ?? '').length };
}

// ---------------------------------------------------------------------------
// Agent loop：和 01 完全同构。唯一的"新东西"是 tools 里多了 load_skill，
// 以及 system prompt 里那段技能目录——skills 对 agent loop 是零侵入的
// ---------------------------------------------------------------------------

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

const BASE_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  ['run_command', '执行白名单内的命令（python3/node）。技能指令里给出的命令可直接照抄执行', { command: { type: 'string' } }, ['command']],
  ['write_file', '把内容写入 output/ 目录下的 .svg 或 .mjs 文件', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']],
].map(([name, description, properties, required]) => ({
  type: 'function' as const,
  function: { name: name as string, description: description as string, parameters: { type: 'object' as const, properties: properties as any, required: required as string[] } },
}));

const LOAD_SKILL_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'load_skill',
    description: '加载指定技能的完整指令（SKILL.md 全文）。判断任务与某技能相关时先调用它。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '技能名，见 system prompt 的技能目录' } },
      required: ['name'],
    },
  },
};

async function runAgent(
  messages: Messages,
  toolHandlers: Record<string, (args: any) => Promise<unknown> | unknown>,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
): Promise<string> {
  for (let step = 1; step <= MAX_STEPS; step++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      ...(extraBody ?? {}),
    });
    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) return msg.content ?? '(空回复)';

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      console.log(`  🔧 ${call.function.name} ${call.function.arguments?.slice(0, 100)}`);
      const args = JSON.parse(call.function.arguments || '{}');
      let result: unknown;
      try {
        result = await toolHandlers[call.function.name]?.(args) ?? { error: `unknown tool: ${call.function.name}` };
      } catch (err: any) {
        result = { error: err.message }; // 失败喂回模型，让它自己换路子（同 06）
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      const brief = JSON.stringify(result);
      console.log(`    ✅ ${brief.slice(0, 120)}${brief.length > 120 ? '...' : ''}`);
    }
  }
  return '(步数预算耗尽)';
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

const TABLE_TASK =
  '把下面的商品数据整理成 ASCII 表格输出（用 | 和 - 做边框），\n' +
  '列与列必须对齐：\n' +
  '机械键盘（青轴）、299 元、库存 42\n' +
  'USB-C 拓展坞、159 元、库存 8\n' +
  '显示器支架（双臂）、219 元、库存 15';

const CHART_TASK =
  '把 2024 各季度销量画成柱状图，保存到 output/sales.svg：\n' +
  'Q1 120、Q2 186、Q3 154、Q4 232（单位：万件）';

const STATS_TASK = '统计这组数字的均值、中位数、标准差、极差：12、40、8、99、63、27';

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const skills = await scanSkills();
  const manifest = renderManifest(skills);
  const manifestTokens = countTokens(manifest);

  console.log('━━ 技能清单（第 1 层：目录常驻）━━');
  for (const s of skills) {
    // 目录成本 = name + description 那一行；全文成本 = 整个 SKILL.md
    const catalogLine = countTokens(`- ${s.name}: ${s.description}`);
    console.log(`  📦 ${s.name.padEnd(15)} 目录 ${String(catalogLine).padStart(3)} tok / 全文 ${s.fullPathTokens} tok`);
  }
  console.log(`  技能目录合计常驻: ${manifestTokens} tokens\n`);

  // ---------------------------------------------------------------------
  // 对照实验 A：不带 skills 的裸模型，同一个表格任务
  // ---------------------------------------------------------------------
  console.log('━━ 实验 A：不带 skills，让模型凭裸本事对齐中英混排表格 ━━');
  const plainMessages: Messages = [
    { role: 'system', content: '你是一个通用助手，用等宽字符的 ASCII 表格回答表格类问题。' },
    { role: 'user', content: TABLE_TASK },
  ];
  const plainReply = await runAgent(plainMessages, {}, []);
  console.log(`\n🤖 实验 A 输出（注意"机械键盘（青轴）"这类全角括号列是否对齐）：\n${plainReply}\n`);

  // ---------------------------------------------------------------------
  // 实验 B/C：带 skills 的 agent，同一会话先后命中两个技能
  // ---------------------------------------------------------------------
  console.log('━━ 实验 B：带 skills（目录已在 system prompt，模型应主动 load_skill）━━');
  const toolHandlers: Record<string, (args: any) => Promise<unknown> | unknown> = {
    load_skill: (a: any) => loadSkill(skills, a.name),
    run_command: runCommand,
    write_file: writeFile,
  };
  const tools = [...BASE_TOOLS, LOAD_SKILL_TOOL];

  const messages: Messages = [
    {
      role: 'system',
      content:
        '你是一个通用助手，装有若干技能（见技能目录）。' +
        '任务与某技能相关时，必须先 load_skill 读完整指令再动手，严格按指令执行。\n\n' +
        manifest,
    },
    { role: 'user', content: TABLE_TASK },
  ];
  const replyB = await runAgent(messages, toolHandlers, tools);
  console.log(`\n🤖 实验 B 输出：\n${replyB}\n`);

  console.log('━━ 实验 C：同一会话第二问，命中另一个（纯指令型）技能 ━━');
  messages.push({ role: 'user', content: CHART_TASK });
  const replyC = await runAgent(messages, toolHandlers, tools);
  console.log(`\n🤖 实验 C 输出：\n${replyC}\n`);

  console.log('━━ 实验 D：内嵌代码型技能——模型中继代码到工具层执行 ━━');
  messages.push({ role: 'user', content: STATS_TASK });
  const replyD = await runAgent(messages, toolHandlers, tools);
  console.log(`\n🤖 实验 D 输出：\n${replyD}\n`);

  // ---------------------------------------------------------------------
  // token 结算：渐进式披露的意义
  // ---------------------------------------------------------------------
  const allFull = skills.reduce((sum, s) => sum + s.fullPathTokens, 0);
  // 命中检测：load_skill 的 tool result 是 JSON.stringify 的，形如 {"skill":"ascii-table",...}
  const loaded = skills.filter((s) => messages.some((m) => typeof m.content === 'string' && m.content.includes(`"skill":"${s.name}"`)));
  const loadedCost = loaded.reduce((sum, s) => sum + s.fullPathTokens, 0);
  const bar = '═'.repeat(60);
  console.log(`${bar}\n📊 token 结算（o200k_base 估算）\n${bar}`);
  console.log(`  方案一（全部正文常驻 system prompt）: ${allFull} tokens/每轮`);
  console.log(`  方案二（渐进式披露）: 目录 ${manifestTokens} + 实际加载 ${loadedCost} = ${manifestTokens + loadedCost} tokens`);
  console.log(`  → 本轮省 ${allFull - manifestTokens - loadedCost} tokens；且未命中的技能永远只花目录的钱`);
  console.log(`  → 实际命中: ${loaded.map((s) => s.name).join('、') || '（无）'}`);

  // 展示产物
  const svg = await fs.readFile(path.join(OUTPUT_DIR, 'sales.svg'), 'utf-8').catch(() => null);
  if (svg) {
    console.log(`\n${bar}\n产物 output/sales.svg（前 12 行）:\n${bar}`);
    console.log(svg.split('\n').slice(0, 12).join('\n'));
  }
  const mjs = await fs.readFile(path.join(OUTPUT_DIR, 'stats.mjs'), 'utf-8').catch(() => null);
  if (mjs) {
    console.log(`\n产物 output/stats.mjs：模型从 SKILL.md 中继落盘的脚本（${mjs.split('\n').length} 行），由 node 而非模型执行`);
  }
}

main();
