/**
 * ============================================================
 * 16 — MCP Server（手写版）：~130 行裸实现 Model Context Protocol
 * ============================================================
 *
 * MCP 的一句白话：把「工具」从进程内函数（01/06 的 toolImplementations
 * 分发表）变成【独立进程/远程机器上的服务】，中间用一份公开的报文
 * 格式说话。于是工具生态可以像 USB 外设一样即插即用——server 不需要
 * 知道 agent 怎么写，agent 也不需要把工具代码拷进自己进程。
 *
 * 本文件是 server 侧的最小实现，只用 Node 标准库：
 *
 *   传输层：stdio（子进程的 stdin/stdout），每行一条 JSON（换行分帧）
 *   消息层：JSON-RPC 2.0 —— {jsonrpc, id, method, params} 三板斧：
 *     · 带 id 的是"请求"，必须回一条同 id 的 {result} 或 {error}
 *     · 不带 id 的是"通知"，收到不用回（如 notifications/initialized）
 *
 * 生命周期（协议规定的握手顺序）：
 *   ① client → initialize（请求）：报上自己的协议版本/能力/名字
 *   ② server → 回 result：报上自己支持的能力（本 server 只有 tools）
 *   ③ client → notifications/initialized（通知）：握手完成
 *   ④ 之后 client 随时 tools/list 拿工具清单、tools/call 调用工具
 *
 * 两条容易踩的铁律：
 *   · stdout 只能输出协议消息——server 自己的日志必须走 stderr，
 *     混进去一行日志 client 就 JSON.parse 失败了
 *   · 工具执行失败 ≠ 协议失败：前者回 result.isError=true（内容照样
 *     给模型看，让它自己换路子），后者才用 JSON-RPC error
 *
 * 被 index.ts（手写 client）和 SDK client 分别连接——同一份实现，
 * 两类 client 都能正常对话，这就是"协议标准化"的意义。
 *
 * 单独观察它: npx tsx 16-mcp/server.ts  （然后手动粘报文试试）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const DATA_DIR = path.join(import.meta.dirname, 'data');

// ---------------------------------------------------------------------------
// 工具实现：mini filesystem，限制在 data/ 目录内（同 06 的安全模型）
// 与 06 唯一的区别：这些函数不注册进 agent 进程，而是藏在 server 进程里
// ---------------------------------------------------------------------------

/** 解析相对路径并限制在 data/ 内，防目录穿越 */
function safeResolve(relPath: unknown): string {
  const rel = typeof relPath === 'string' && relPath.trim() ? relPath : '.';
  const p = path.resolve(DATA_DIR, rel.replace(/^\.?\//, ''));
  if (p !== DATA_DIR && !p.startsWith(DATA_DIR + path.sep)) {
    throw new Error(`path escapes data/: ${relPath}`);
  }
  return p;
}

async function listDir(args: any) {
  const entries = await fs.readdir(safeResolve(args.path), { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
}

async function readFile(args: any) {
  const content = await fs.readFile(safeResolve(args.path), 'utf-8');
  return content.slice(0, 4000); // 限长：结果要进模型的上下文
}

async function wcFile(args: any) {
  const content = await fs.readFile(safeResolve(args.path), 'utf-8');
  return JSON.stringify({
    path: args.path,
    lines: content.split('\n').length,
    words: content.split(/\s+/).filter(Boolean).length,
    bytes: Buffer.byteLength(content),
  });
}

// ---------------------------------------------------------------------------
// 工具清单：MCP 的 inputSchema 就是 JSON Schema，和 OpenAI 工具的
// parameters 完全同构——所以 client 侧的适配层薄到只有字段改名
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_dir',
    description: '列出 data 目录（或其子目录）下的文件',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对 data/ 的路径，默认根目录' } },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: '读取 data 目录下某个文本文件的内容',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对 data/ 的文件路径' } },
      required: ['path'],
    },
  },
  {
    name: 'wc',
    description: '统计某个文件的行数、词数、字节数',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对 data/ 的文件路径' } },
      required: ['path'],
    },
  },
] as const;

const IMPLEMENTATIONS: Record<string, (args: any) => Promise<string>> = {
  list_dir: listDir,
  read_file: readFile,
  wc: wcFile,
};

// ---------------------------------------------------------------------------
// JSON-RPC 分发：MCP server 的全部协议逻辑就这一个 switch
// ---------------------------------------------------------------------------

function send(message: object) {
  process.stdout.write(JSON.stringify(message) + '\n'); // 换行分帧：一条消息一行
}

function log(msg: string) {
  process.stderr.write(`[raw-fs-server] ${msg}\n`); // 日志只能走 stderr！
}

async function handleMessage(msg: any): Promise<void> {
  // 通知（无 id）不需要应答——如 notifications/initialized
  if (msg.id === undefined) {
    log(`通知: ${msg.method}（无需应答）`);
    return;
  }

  try {
    switch (msg.method) {
      case 'initialize': {
        // 回显 client 的协议版本（规范：支持 client 版本就回显）
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} }, // 能力声明：本 server 提供工具
            serverInfo: { name: 'raw-fs-server', version: '1.0.0' },
          },
        });
        break;
      }
      case 'tools/list': {
        send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
        break;
      }
      case 'tools/call': {
        const name = msg.params?.name;
        const impl = IMPLEMENTATIONS[name as string];
        if (!impl) {
          // 协议层错误：方法存在但参数里的工具名不认识
          send({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32602, message: `unknown tool: ${name}` },
          });
          break;
        }
        try {
          const text = await impl(msg.params?.arguments ?? {});
          // 成功：content 数组是 MCP 的结果格式（还支持图片等，本例只用 text）
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
        } catch (err: any) {
          // 工具执行失败：isError 标记，文本照样返回——agent 会把它喂给模型
          send({
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: `error: ${err.message}` }], isError: true },
          });
        }
        break;
      }
      default:
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `method not found: ${msg.method}` },
        });
    }
  } catch (err: any) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } });
  }
}

// stdio 传输：逐行读 stdin，一行 = 一条 JSON-RPC 消息
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    void handleMessage(JSON.parse(line)); // 异步处理，响应靠 id 配对不靠顺序
  } catch {
    log(`无法解析的行: ${line.slice(0, 80)}`);
  }
});
log('已启动，等待 stdin 上的 JSON-RPC 消息（stdout 专用，本日志走 stderr）');
