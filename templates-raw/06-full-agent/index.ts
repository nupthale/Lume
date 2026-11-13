/**
 * ============================================================
 * 06 — Mini Claude Code：通用工具集 + 上下文压缩 + 计划审批 + Todo
 * 对照场景: Claude Code / Trae 这类编程 agent 的骨架
 * ============================================================
 *
 * 前面 5 个例子证明了 agent loop 就是 while + messages。这个例子回答
 * "那 Claude Code / Trae 背后到底是什么"——还是同一个循环，升级四件事：
 *
 *   1. 工具从场景专用（查订单/退款）换成通用感知/行动集：
 *      读文件、列目录、写文件、改文件、跑命令。
 *      "先做哪步、要不要搜网页"不是代码里的 if/else，
 *      是模型看着工具清单和任务自己决定的（模型提议，代码执行）。
 *
 *   2. 接入真实外部世界：web_search 抓 Bing 结果页、web_fetch 抓网页正文。
 *      两者都是真实 HTTP 请求，没有 mock。
 *
 *   3. messages 换成 ContextManager：每次调模型前估算 token，超阈值就把
 *      旧历史压成一条摘要（Claude Code 的 /compact 的自动版）。
 *      长任务不爆 context 靠的就是这个。
 *
 *   4. 生产级 agent 的两件套（Trae/Claude Code 都有）：
 *      - Plan mode：先只允许只读工具调研 → submit_plan 提交计划 →
 *        人批准（终端 y/n，就是 04 的 HITL 暂停点）→ 才放开写操作。
 *        "先分析思考要怎么做"不是什么架构功能，就是 prompt 引导 + 这道审批门。
 *      - TodoWrite：计划获批后登记成任务清单（结构化数据），
 *        模型靠它把计划外置——UI 能渲染成勾选面板，压缩历史时也不会丢。
 *
 * 安全模型 = "模型提议，代码否决"（所有校验都发生在工具执行边界）：
 *   - 文件路径限制在 workspace/ 内，越界直接报错
 *   - 命令白名单 + 超时（生产版是容器沙箱）
 *   - 计划模式期间写工具直接被代码拦截（不靠模型自觉）
 *   - 网页抓取限大小限时长
 *
 * 运行: npx tsx 06-full-agent/index.ts
 *   （需要能访问 bing.com 的网络；中途会停下等你批准计划，输入 y/n。
 *    设 KEEP_THINKING=1 可以看到模型每步的思考过程——
 *    Trae 界面上那段"分析思考"的一部分来源就是它）
 */

import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type Todo = { content: string; status: 'pending' | 'in_progress' | 'done' };

const WORKSPACE = path.join(import.meta.dirname, 'workspace');
const MAX_STEPS = 16;
const PLANNING_BUDGET = 6; // 计划阶段的步数预算
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// ---------------------------------------------------------------------------
// 生产级 system prompt：身份 + 工作流程 + 工具规则 + 汇报规范。
// 和玩具 prompt 的区别：显式规定"先规划再执行"的工作流（Trae/Claude Code
// 的"先分析"就是被这类指令引导出来的），而不只是零散的行为约束。
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是一个通用 agent（教学版 mini Claude Code），能读写文件、执行白名单命令、搜索和抓取网页。

# 工作流程
1. 计划阶段：只用只读工具调研，摸清现状后调用 submit_plan 提交分步计划
2. 计划获批后，立即调用 update_todo 把计划登记为任务清单
3. 同一时刻只有一个任务处于 in_progress；开始做就标记，做完就标 done
4. 执行中发现前提不成立（文件不存在、信息矛盾、工具报错），先更新计划再继续，不要硬走
5. 全部完成后逐项核对任务清单，确认无遗漏再汇报

# 工具规则
- 改文件前必须先 read_file 看准确内容；edit_file 的 old_string 必须逐字匹配
- 时效性信息（版本号、新闻、价格）必须先 web_search/web_fetch 核实，禁止凭记忆回答
- 路径一律相对 workspace/

# 汇报规范
- 简洁直接，先结论后过程；引用事实给出处（文件路径或 URL）`;

// ---------------------------------------------------------------------------
// 文件/命令工具：路径安全 + 命令白名单（"模型提议，代码否决"的边界）
// ---------------------------------------------------------------------------

/** 解析相对路径并限制在 workspace 内，防止模型写出 ../../etc/passwd */
function safeResolve(relPath: unknown): string {
  if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('invalid path');
  // 模型可能传 "workspace/xxx" 或 "./xxx"，都归一化成相对 workspace 的路径
  const rel = relPath.replace(/^\.?\//, '').replace(/^workspace\//, '');
  const p = path.resolve(WORKSPACE, rel);
  if (p !== WORKSPACE && !p.startsWith(WORKSPACE + path.sep)) {
    throw new Error(`path escapes workspace: ${relPath}`);
  }
  return p;
}

async function readFile(args: any) {
  const content = await fs.readFile(safeResolve(args.path), 'utf-8');
  return { path: args.path, content: content.slice(0, 6000) }; // 限长：整个文件灌进上下文会瞬间吃掉预算
}

async function listDir(args: any) {
  const entries = await fs.readdir(safeResolve(args.path ?? '.'), { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
}

async function writeFile(args: any) {
  await fs.writeFile(safeResolve(args.path), String(args.content ?? ''), 'utf-8');
  return { ok: true, path: args.path, bytes: String(args.content ?? '').length };
}

async function editFile(args: any) {
  const p = safeResolve(args.path);
  const content = await fs.readFile(p, 'utf-8');
  const old = String(args.old_string ?? '');
  if (!old || !content.includes(old)) {
    return { error: 'old_string not found（改文件前应先 read_file 看准确内容）' };
  }
  await fs.writeFile(p, content.replace(old, String(args.new_string ?? '')), 'utf-8');
  return { ok: true, path: args.path };
}

/** 命令白名单：教学版的安全边界。生产版是容器沙箱 + HITL 审批 */
const CMD_ALLOWLIST = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'echo', 'pwd', 'diff', 'mkdir', 'touch', 'node', 'python3',
]);

const execAsync = promisify(exec);

async function runCommand(args: any) {
  const cmd = String(args.command ?? '').trim();
  if (!cmd) return { error: 'empty command' };
  if (!CMD_ALLOWLIST.has(cmd.split(/\s+/)[0])) {
    return { error: `command not in allowlist: ${cmd.split(/\s+/)[0]}（白名单: ${[...CMD_ALLOWLIST].join(' ')}）` };
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: WORKSPACE, timeout: 15_000, maxBuffer: 1_000_000 });
    return { command: cmd, stdout: stdout.slice(0, 3000), stderr: stderr.slice(0, 1000) || undefined };
  } catch (err: any) {
    return { command: cmd, error: err.message?.slice(0, 500) };
  }
}

// ---------------------------------------------------------------------------
// 网络工具：真实 HTTP（Bing 结果页解析 + 网页正文提取）
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[e as string]!,
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, '');
}

/** web_search：抓 Bing 结果页，解析 <h2><a> 里的标题和链接（无 API key 的土办法，够教学用） */
async function webSearch(args: any): Promise<unknown> {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'empty query' };
  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': UA, 'accept-language': 'en,zh-CN;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { error: `search failed: HTTP ${res.status}` };
    const html = await res.text();
    const results: { title: string; url: string }[] = [];
    for (const m of html.matchAll(/<h2[^>]*><a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const url = m[1];
      if (/bing\.com|microsoft\.com|microsofttranslator/.test(url)) continue; // 过滤站内链接
      if (results.some((r) => r.url === url)) continue;
      results.push({ title: stripTags(m[2]).trim(), url });
      if (results.length >= 5) break;
    }
    return results.length ? { results } : { error: 'no results parsed' };
  } catch (err: any) {
    return { error: `search failed: ${err.message}` };
  }
}

/** web_fetch：抓网页，去掉 script/style 和标签，截取正文前 4000 字符 */
async function webFetch(args: any): Promise<unknown> {
  const url = String(args.url ?? '');
  if (!/^https?:\/\//.test(url)) return { error: 'only http(s) urls' };
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { error: `fetch failed: HTTP ${res.status}` };
    const html = (await res.text()).slice(0, 500_000); // 限大小，防超大页面
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
    const text = stripTags(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    return { url, title, text };
  } catch (err: any) {
    return { error: `fetch failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// 工具注册表：OpenAI 协议的 tools 定义 ↔ 执行器一一对应。
// Claude Code 的本质就是这张表（它的表里有 Read/Edit/Bash/Grep/Task...）
//
// 两套工具集是 plan mode 的关键：
//   PLANNING_TOOLS = 只读工具 + submit_plan（调研 + 提交计划）
//   EXEC_TOOLS     = 全部工具 + update_todo（计划获批后才用）
// ---------------------------------------------------------------------------

const CORE_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  ['read_file', '读取 workspace 内的文件内容', { path: { type: 'string' } }, ['path']],
  ['list_dir', '列出 workspace 内某目录的内容', { path: { type: 'string' } }, []],
  ['write_file', '把内容写入 workspace 内的文件（覆盖）', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']],
  ['edit_file', '精确替换文件中的一段文本。改之前必须先 read_file', { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, ['path', 'old_string', 'new_string']],
  ['run_command', '在 workspace 目录执行白名单内的 shell 命令', { command: { type: 'string' } }, ['command']],
  ['web_search', '搜索网页，返回标题和链接。回答时效性问题前应先搜索', { query: { type: 'string' } }, ['query']],
  ['web_fetch', '抓取网页正文（纯文本，截取前 4000 字符）', { url: { type: 'string' } }, ['url']],
].map(([name, description, properties, required]) => ({
  type: 'function' as const,
  function: { name: name as string, description: description as string, parameters: { type: 'object' as const, properties: properties as any, required: required as string[] } },
}));

const SUBMIT_PLAN_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_plan',
    description: '提交分步执行计划，等待用户审批。获批前只能使用只读工具调研，禁止写操作。',
    parameters: {
      type: 'object',
      properties: { plan: { type: 'string', description: '分步执行计划，markdown 列表' } },
      required: ['plan'],
    },
  },
};

const UPDATE_TODO_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'update_todo',
    description:
      '更新任务清单（全量替换）。计划获批后立即登记；每开始一项标 in_progress，' +
      '完成一项标 done。任务清单是长任务的进度锚点，状态变化时都应调用。',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

/** 计划模式放行的只读工具（写操作在代码层面拦截，不靠模型自觉） */
const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'web_search', 'web_fetch']);

const PLANNING_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  ...CORE_TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.function.name)),
  SUBMIT_PLAN_TOOL,
];

const EXEC_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [...CORE_TOOLS, UPDATE_TODO_TOOL];

const TOOL_HANDLERS: Record<string, (args: any) => Promise<unknown> | unknown> = {
  read_file: readFile,
  list_dir: listDir,
  write_file: writeFile,
  edit_file: editFile,
  run_command: runCommand,
  web_search: webSearch,
  web_fetch: webFetch,
};

// ---------------------------------------------------------------------------
// ContextManager：messages 数组 + 估算 + 自动压缩 + 任务清单
//
// 为什么需要：agent 跑十几步后，messages 里堆满工具结果（一次 web_fetch
// 就是几千 token），很快撞上模型 context 上限。解法 = 压缩（compact）：
// 旧历史让 LLM 自己总结成一条摘要，只保留最近几轮原文。
// 这是 Claude Code /compact、Trae 自动压缩的共同原理。
//
// todo 清单也归它管：压缩后把最新清单重新注入摘要消息，
// 保证长任务中计划永远不会被压缩吃掉（Claude Code 的 TodoWrite 同理）。
//
// 教学简化：token 数用 字符数/3 粗估（生产用真实 tokenizer 或 usage 回传）。
// ---------------------------------------------------------------------------

const MAX_CONTEXT_TOKENS = 3000; // 压缩阈值（故意调低，让演示中一定会触发；Qwen3 实际窗口大得多）
const KEEP_RECENT = 6; // 压缩时保留最近几条消息原文

class ContextManager {
  messages: Messages;
  todos: Todo[] = [];
  compactCount = 0;

  constructor(systemPrompt: string, userTask: string) {
    this.messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userTask },
    ];
  }

  /** 粗估当前 messages 的 token 数 */
  estimateTokens(): number {
    return Math.ceil(JSON.stringify(this.messages).length / 3);
  }

  /**
   * 超过阈值就把旧历史压成一条摘要。返回是否发生了压缩。
   *
   * 切点规则：agent 长任务里往往只有一条 user 消息、后面全是
   * assistant(tool_calls) ↔ tool 配对，所以不能按"往回找 user 消息"切，
   * 而是往回跳过 tool 消息——保证不会把 tool 结果和发起它的 assistant
   * 切在两侧（切断了下次请求直接 400）。
   */
  async maybeCompact(): Promise<boolean> {
    const before = this.estimateTokens();
    if (before < MAX_CONTEXT_TOKENS) return false;

    let cut = this.messages.length - KEEP_RECENT;
    while (cut > 1 && this.messages[cut].role === 'tool') cut--; // 切口不能落在 tool 结果上
    if (cut <= 1) return false;

    const toCompress = this.messages.slice(1, cut); // system 不参与压缩
    // 可压内容太少就别压了（比如只剩上一轮的摘要本身），避免反复压缩空转
    if (Math.ceil(JSON.stringify(toCompress).length / 3) < 800) return false;

    // 调一次 LLM 把旧历史总结成摘要——"用模型管理模型的上下文"
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            '你是上下文压缩器。把这段 agent 对话历史压缩成信息密度最高的中文摘要，' +
            '必须保留：任务目标与已获批的计划、已读取文件的关键内容、搜索/抓取到的关键事实' +
            '（含版本号/数字/URL）、已写的文件及内容要点、已做和未做的步骤。直接输出摘要正文。',
        },
        { role: 'user', content: JSON.stringify(toCompress) },
      ],
      ...(extraBody ?? {}),
    });
    const summary = res.choices[0].message.content ?? '';

    // 任务清单是结构化状态，压缩后原样重注入——计划永不丢失
    const todoBlock = this.todos.length
      ? `\n\n<todo_state>当前任务清单（最新状态，继续据此执行）:\n${this.todos
          .map((t) => `- [${t.status}] ${t.content}`)
          .join('\n')}</todo_state>`
      : '';

    this.messages = [
      this.messages[0], // system 原样保留
      {
        role: 'user',
        content:
          `<context_summary>（此前 ${toCompress.length} 条消息已自动压缩为摘要）\n${summary}</context_summary>` +
          todoBlock,
      },
      ...this.messages.slice(cut),
    ];
    this.compactCount++;

    const after = this.estimateTokens();
    console.log(`  🗜️  上下文压缩: ${toCompress.length} 条旧消息 → 1 条摘要 (est ${before} → ${after} tokens)`);
    return true;
  }
}

// ---------------------------------------------------------------------------
// 工具执行器（计划/执行两阶段共用）
// ---------------------------------------------------------------------------

function printTodos(todos: Todo[]) {
  const marks: Record<Todo['status'], string> = { pending: '⬜', in_progress: '▶️', done: '✅' };
  console.log('  📋 任务清单:');
  for (const t of todos) console.log(`     ${marks[t.status] ?? '⬜'} ${t.content}`);
}

async function executeToolCall(ctx: ContextManager, call: ToolCall, allowed?: Set<string>): Promise<unknown> {
  // ⚠️ 工具参数是模型生成的，不可信任：每个工具内部都做了校验兜底
  const args = JSON.parse(call.function.arguments || '{}');
  console.log(`  🔧 ${call.function.name} ${call.function.arguments?.slice(0, 120)}`);

  let result: unknown;
  if (allowed && !allowed.has(call.function.name)) {
    // 计划模式的写操作拦截：安全边界在代码，不在模型的自觉
    result = { error: `计划模式禁止执行 ${call.function.name}，请先 submit_plan 获批` };
  } else if (call.function.name === 'update_todo') {
    const raw = Array.isArray(args.todos) ? args.todos.filter((t: any) => t && typeof t.content === 'string') : [];
    ctx.todos = raw.map((t: any) => ({
      content: String(t.content),
      status: t.status === 'in_progress' || t.status === 'done' ? t.status : 'pending',
    }));
    printTodos(ctx.todos);
    result = { ok: true, todos: ctx.todos };
  } else {
    const handler = TOOL_HANDLERS[call.function.name];
    // 工具执行失败不抛异常——错误作为 tool result 喂回模型，它会自己换路子
    // （比如文件不存在就去 list_dir 先看看），这就是 agent 的自愈能力来源
    try {
      result = handler ? await handler(args) : { error: `unknown tool: ${call.function.name}` };
    } catch (err: any) {
      result = { error: err.message };
    }
  }

  ctx.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
  const brief = JSON.stringify(result);
  console.log(`    ✅ ${brief.slice(0, 150)}${brief.length > 150 ? '...' : ''}`);
  return result;
}

// ---------------------------------------------------------------------------
// 阶段 1 — Plan mode：只读调研 + 计划审批
// （Trae"先出方案、点确认再执行"的最小实现：提交计划处就是 04 的 HITL 暂停点，
//  区别只是这道门卡在"放开写操作之前"，而不是某个敏感工具之前）
// ---------------------------------------------------------------------------

async function planningPhase(ctx: ContextManager): Promise<void> {
  console.log('━━ Plan Mode：只读调研 → 提交计划 → 人工审批 ━━\n');
  ctx.messages.push({
    role: 'user',
    content:
      '<plan_mode>现在处于计划模式：只能使用只读工具（read_file/list_dir/web_search/web_fetch）调研，' +
      '禁止任何写操作。调研清楚后调用 submit_plan 提交分步执行计划，等待用户审批。</plan_mode>',
  });

  for (let step = 1; step <= PLANNING_BUDGET; step++) {
    console.log(`── Plan Step ${step}/${PLANNING_BUDGET} ──`);
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: ctx.messages,
      tools: PLANNING_TOOLS,
      ...(extraBody ?? {}),
    });
    const msg = response.choices[0].message;
    ctx.messages.push(msg);

    if (!msg.tool_calls?.length) {
      ctx.messages.push({ role: 'user', content: '请继续调研，或调用 submit_plan 提交计划。' });
      continue;
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;

      if (call.function.name === 'submit_plan') {
        const args = JSON.parse(call.function.arguments || '{}');
        console.log(`\n� 执行计划:\n${'─'.repeat(56)}\n${args.plan}\n${'─'.repeat(56)}`);

        // === HITL 暂停点：循环在这里挂起，等人点头（同 04 的 await rl.question）===
        const answer = (await rl.question('\n批准此计划吗？(y/n) ')).toLowerCase().trim();
        if (answer === 'y') {
          ctx.messages.push({ role: 'tool', tool_call_id: call.id, content: 'APPROVED: 用户已批准该计划' });
          ctx.messages.push({
            role: 'user',
            content:
              '<plan_approved>计划已获批，进入执行模式。立即调用 update_todo 把计划登记为任务清单，' +
              '然后逐步执行；每开始/完成一项就更新一次状态。</plan_approved>',
          });
          console.log('\n✅ 计划已批准，进入执行模式\n');
          return;
        }
        // 拒绝也是信息：原因喂回模型，它会修改计划重新提交
        ctx.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'REJECTED: 用户拒绝该计划，请调整思路（可继续调研）后重新 submit_plan',
        });
        console.log('\n❌ 计划被拒，模型将修改后重新提交\n');
        continue;
      }

      await executeToolCall(ctx, call, READ_ONLY_TOOLS); // 只放行只读工具
    }
  }
  throw new Error('计划阶段步数预算耗尽，未获得批准的计划');
}

// ---------------------------------------------------------------------------
// 阶段 2 — 执行：和 01 相同的 agent loop 骨架。
// 区别只有三点：工具走注册表、调模型前先 maybeCompact、含 update_todo
// ---------------------------------------------------------------------------

async function runAgent(ctx: ContextManager) {
  let totalTokens = 0;

  for (let step = 1; step <= MAX_STEPS; step++) {
    await ctx.maybeCompact(); // ← 压缩点：保证发给模型的 messages 永远在预算内
    console.log(`── Step ${step}/${MAX_STEPS} (est ${ctx.estimateTokens()} tokens, 已压缩 ${ctx.compactCount} 次) ──`);

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: ctx.messages,
      tools: EXEC_TOOLS,
      ...(extraBody ?? {}),
    });
    totalTokens += response.usage?.total_tokens ?? 0;
    const msg = response.choices[0].message;
    ctx.messages.push(msg);

    if (!msg.tool_calls?.length) {
      console.log(`\n🤖 ${msg.content}`);
      if (ctx.todos.length) printTodos(ctx.todos);
      console.log(`\n（共 ${step} 步，实际消耗 ${totalTokens} tokens，上下文压缩 ${ctx.compactCount} 次）`);
      return;
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      await executeToolCall(ctx, call);
    }
  }
  console.log(`\n⏰ 步数预算耗尽（实际消耗 ${totalTokens} tokens，压缩 ${ctx.compactCount} 次）`);
}

// ---------------------------------------------------------------------------
// 演示：一个需要"读任务 → 调研 → 计划审批 → 执行 → 写文件 → 跑命令"的完整流程
// ---------------------------------------------------------------------------

async function main() {
  // 准备工作区：inbox.md 是任务输入；清掉上次运行可能留下的 notes.md
  await fs.mkdir(WORKSPACE, { recursive: true });
  await fs.rm(path.join(WORKSPACE, 'notes.md'), { force: true });
  await fs.writeFile(
    path.join(WORKSPACE, 'inbox.md'),
    [
      '# 调研任务',
      '1. 上网搜索 Node.js 当前的 LTS 版本号',
      '2. 打开 1-2 个 nodejs.org 官网页面核实',
      '3. 把结论写成 notes.md（版本号、大致发布信息、信息来源 URL）',
      '4. 运行命令列出 workspace 目录，确认 notes.md 已生成',
    ].join('\n'),
    'utf-8',
  );

  console.log('场景：任务说明在 workspace/inbox.md 里。agent 会先只读调研并提交计划');
  console.log('等你批准（y/n），获批后才登记任务清单并开始执行。\n');
  console.log(`工作区: ${WORKSPACE}\n`);

  const ctx = new ContextManager(
    SYSTEM_PROMPT,
    '读取 workspace/inbox.md，按里面的任务说明完成工作。',
  );

  await planningPhase(ctx); // 阶段 1：调研 + 计划 + 人工审批（HITL）
  await runAgent(ctx); // 阶段 2：执行（还是那个 agent loop）

  rl.close();

  // 展示产物
  const notes = await fs.readFile(path.join(WORKSPACE, 'notes.md'), 'utf-8').catch(() => null);
  if (notes) {
    const bar = '═'.repeat(60);
    console.log(`\n${bar}\n产物 workspace/notes.md:\n${bar}`);
    console.log(notes);
  }
}

main();
