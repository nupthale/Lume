/**
 * ============================================================
 * 16 — MCP（Model Context Protocol）：工具从「进程内函数」变「跨进程服务」
 * 对照场景: Trae 的 lark 插件、Claude Desktop 的 MCP 生态
 * ============================================================
 *
 * 01/06 里工具长这样：
 *
 *   const toolImplementations = { get_weather: (args) => {...} }  // 同进程直接调
 *
 * MCP 之后工具长这样：
 *
 *   agent 进程                     server 进程（完全独立，甚至别家写的）
 *   ┌─────────────┐   stdio/HTTP   ┌──────────────────┐
 *   │  agent loop │ ─────────────→ │ tools/list 发现  │
 *   │  (不变!)    │ ←───────────── │ tools/call 执行  │
 *   └─────────────┘  JSON-RPC 2.0  └──────────────────┘
 *
 * agent loop 一行不改——工具定义从"本地数组"换成"启动时问 server 要"，
 * 工具执行从"函数调用"换成"发一条 tools/call"。
 *
 * 本例三幕剧（server 实现在 server.ts / sdk-server.ts，先去读它们）：
 *   第一幕  手写 client ↔ 手写 server：spawn 子进程 + 裸 JSON-RPC，
 *          打印每一行报文，看清 initialize → tools/list → tools/call
 *          的完整对话，再接回 agent loop 完成真实任务
 *   第二幕  SDK client ↔ 手写 server：官方 @modelcontextprotocol/sdk
 *          的 Client 十几行干完第一幕手写的全部协议工作——你的裸
 *          server 直接被 SDK 客户端连接成功
 *   第三幕  手写 client ↔ SDK server：反过来，手写 client 连 SDK 写的
 *          server 也正常工作。双向互通 = 协议标准化的意义：
 *          client 和 server 谁都不认识谁，只认识报文格式
 *
 * 运行: npx tsx 16-mcp/index.ts
 */

import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };

const DIR = import.meta.dirname;
const SERVER_PATH = path.join(DIR, 'server.ts');
const SDK_SERVER_PATH = path.join(DIR, 'sdk-server.ts');
const MAX_STEPS = 8;

/** 任务数据（agent 只能通过 MCP server 的工具看到它们） */
const TASK = 'data 目录（server 眼里的 data/）下有哪些文件？哪个文件行数最多？内容讲什么？';

// ---------------------------------------------------------------------------
// 手写 MCP client：spawn 子进程 + 逐行 JSON + 按 id 配对应答
// 与 server.ts 合起来 ~200 行，就是 stdio MCP 的全部协议
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '2025-06-18';

class RawMcpClient {
  private proc: ChildProcess;
  private nextId = 1;
  /** id → pending 的 resolve/reject。响应可能乱序到达，靠 id 而不是顺序配对 */
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  /** 打印每条收发报文（第一幕的教学重点就在这里） */
  verbose: boolean = false;

  constructor(serverPath: string) {
    this.proc = spawn('tsx', [serverPath], {
      stdio: ['pipe', 'pipe', 'inherit'], // stderr 直通终端：server 的日志走 stderr，看得见
    });
    this.proc.on('exit', (code) => {
      for (const { reject } of this.pending.values()) reject(new Error(`server exited: ${code}`));
      this.pending.clear();
    });

    // 逐行读 stdout：一行 = 一条 JSON-RPC 消息（换行分帧）
    readline.createInterface({ input: this.proc.stdout! }).on('line', (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.log(`← ${JSON.stringify(msg)}`);
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
      // 无 id 的消息（server → client 通知）本例忽略
    });
  }

  private log(s: string) {
    if (this.verbose) console.log(`    ${s.length > 400 ? s.slice(0, 400) + '…' : s}`);
  }

  private send(message: object) {
    this.log(`→ ${JSON.stringify(message)}`);
    this.proc.stdin!.write(JSON.stringify(message) + '\n');
  }

  /** 请求：带 id，等对应 id 的响应 */
  private request<T = any>(method: string, params?: object): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** 通知：不带 id，发完不等 */
  private notify(method: string) {
    this.send({ jsonrpc: '2.0', method });
  }

  /** MCP 生命周期：initialize 握手 → initialized 通知 → 才允许后续请求 */
  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'raw-client', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
    return result;
  }

  listTools() {
    return this.request<{ tools: { name: string; description: string; inputSchema: any }[] }>('tools/list');
  }

  callTool(name: string, args: Record<string, unknown>) {
    return this.request<{ content: { type: string; text: string }[]; isError?: boolean }>('tools/call', {
      name,
      arguments: args,
    });
  }

  close() {
    this.proc.kill();
  }
}

/**
 * 适配层：MCP 工具 → OpenAI 工具定义。
 * MCP 的 inputSchema 就是 JSON Schema，与 OpenAI 的 parameters 同构，
 * 所以整个"翻译"只有字段改名——协议标准化的红利
 */
function mcpToolsToOpenAI(mcpTools: { name: string; description: string; inputSchema: any }[]) {
  return mcpTools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** MCP 结果 → tool result 字符串（content 数组拼接） */
function mcpResultToText(result: { content: { type: string; text: string }[] }) {
  return result.content.map((c) => c.text).join('\n');
}

// ---------------------------------------------------------------------------
// Agent loop：与 01 逐行同构。工具执行的唯一区别：从"调本地函数"
// 变成"await mcp.callTool(...)"——模型完全感知不到工具在另一个进程里
// ---------------------------------------------------------------------------

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

interface ToolBackend {
  listTools(): Promise<{ tools: { name: string; description: string; inputSchema: any }[] }>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
}

async function runAgent(backend: ToolBackend, task: string): Promise<string> {
  const messages: Messages = [
    { role: 'system', content: '你是一个通用助手，只能通过提供的工具查看文件系统 data/ 目录。' },
    { role: 'user', content: task },
  ];
  const tools = mcpToolsToOpenAI((await backend.listTools()).tools);

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
      const args = JSON.parse(call.function.arguments || '{}');
      console.log(`  🔧 ${call.function.name} ${JSON.stringify(args)}`); // 工具在别的进程里，模型毫无感知
      const result = await backend.callTool(call.function.name, args);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: mcpResultToText(result),
      });
    }
  }
  return '(步数预算耗尽)';
}

// ---------------------------------------------------------------------------
// 三幕剧
// ---------------------------------------------------------------------------

async function act1() {
  console.log('━━ 第一幕：手写 client ↔ 手写 server（看清每一条报文）━━\n');
  const mcp = new RawMcpClient(SERVER_PATH);
  mcp.verbose = true;

  const info = await mcp.initialize();
  console.log(`  握手完成: server = ${info.serverInfo.name}，能力 = ${JSON.stringify(info.capabilities)}\n`);

  const { tools } = await mcp.listTools();
  console.log(`  发现 ${tools.length} 个工具: ${tools.map((t) => t.name).join(', ')}\n`);

  console.log('  接回 agent loop（01 的循环，零修改）执行真实任务:\n');
  mcp.verbose = false; // 后面的调用报文太长，只在上面演示协议细节
  const reply = await runAgent(mcp, TASK);
  console.log(`\n🤖 ${reply}\n`);

  mcp.close();
}

async function act2() {
  console.log('━━ 第二幕：SDK client ↔ 手写 server（官方客户端连你的裸 server）━━\n');
  // SDK client：transport 负责 spawn/分帧，Client 负协议；协议代码 = 0 行
  const transport = new StdioClientTransport({ command: 'tsx', args: [SERVER_PATH] });
  const sdk = new Client({ name: 'sdk-client', version: '1.0.0' });
  await sdk.connect(transport);

  const { tools } = await sdk.listTools();
  console.log(`  SDK client 连接裸 server 成功，发现同样的工具: ${tools.map((t) => t.name).join(', ')}`);

  const result = await sdk.callTool({ name: 'wc', arguments: { path: 'changelog.md' } });
  console.log(`  callTool(wc, changelog.md) → ${(result.content as any[])[0].text}\n`);

  await sdk.close();
}

async function act3() {
  console.log('━━ 第三幕：手写 client ↔ SDK server（反向互通）━━\n');
  const mcp = new RawMcpClient(SDK_SERVER_PATH);
  mcp.verbose = true;

  const info = await mcp.initialize();
  console.log(`  握手完成: server = ${info.serverInfo.name}（SDK 写的），协议版本 ${info.protocolVersion}`);

  const { tools } = await mcp.listTools();
  console.log(`  发现 ${tools.length} 个工具: ${tools.map((t) => t.name).join(', ')} ← 与第一幕完全一致\n`);

  mcp.close();
}

// ---------------------------------------------------------------------------

async function main() {
  // 准备 server 眼中的"文件系统"（幂等）
  const dataDir = path.join(DIR, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'roadmap.md'),
    ['# v2 路线图', '- 记忆分层存储', '- 工具权限审批', '- 多 agent 并行', '- 评测集回归门'].join('\n'),
    'utf-8',
  );
  await fs.writeFile(
    path.join(dataDir, 'api-notes.md'),
    ['# API 设计笔记', '- 统一错误码结构', '- 游标分页而非 offset', '- 幂等键放请求头'].join('\n'),
    'utf-8',
  );
  await fs.writeFile(
    path.join(dataDir, 'changelog.md'),
    [
      '# Changelog',
      '## 0.3.0',
      '- 新增 skills 目录扫描',
      '- 修复中文对齐',
      '## 0.2.0',
      '- 接入 MCP server',
      '- 增加评测脚本',
      '## 0.1.0',
      '- 第一个能跑的 agent loop',
    ].join('\n'),
    'utf-8',
  );

  await act1();
  await act2();
  await act3();

  console.log('━━ 结论 ━━');
  console.log('  MCP 之后的分工：agent 作者只写 loop + 适配层，工具作者只写 server，');
  console.log('  两边靠报文格式解耦。加一个新工具 = 换/加一个 server，agent 代码不动。');
}

main();
