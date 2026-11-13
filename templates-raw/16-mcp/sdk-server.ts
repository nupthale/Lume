/**
 * ============================================================
 * 16 — MCP Server（官方 SDK 版）：与 server.ts 完全相同的功能
 * ============================================================
 *
 * 对照读 server.ts：手写版 ~130 行协议代码（JSON-RPC 分发、换行分帧、
 * id 配对、错误分层），SDK 版全部收进 McpServer + StdioServerTransport
 * 两个对象里，你只声明"我有哪些工具"。
 *
 * 价值取舍：
 *   + 代码短、协议版本协商/能力声明/传输重连这些都是现成的
 *   − 协议细节被藏起来，出错时不知道哪层坏了——所以先读 server.ts
 *
 * 关键观察：本文件与 server.ts 暴露完全相同的工具（同名、同 schema），
 * 所以 index.ts 里【手写的 client】也能直接连接本文件并正常工作——
 * 协议一致，实现随便换，这就是标准化带来的互操作。
 *
 * 单独观察它: npx tsx 16-mcp/sdk-server.ts
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DATA_DIR = path.join(import.meta.dirname, 'data');

/** 与 server.ts 相同的路径安全逻辑 */
function safeResolve(relPath: string): string {
  const rel = relPath.trim() ? relPath : '.';
  const p = path.resolve(DATA_DIR, rel.replace(/^\.?\//, ''));
  if (p !== DATA_DIR && !p.startsWith(DATA_DIR + path.sep)) {
    throw new Error(`path escapes data/: ${relPath}`);
  }
  return p;
}

const server = new McpServer({ name: 'sdk-fs-server', version: '1.0.0' });

// registerTool(name, {描述 + zod 参数 shape}, handler)
// zod schema 会被 SDK 自动编译成 MCP 的 JSON Schema 下发——和手写版
// TOOLS 里的 inputSchema 是同一种东西
server.registerTool(
  'list_dir',
  {
    description: '列出 data 目录（或其子目录）下的文件',
    inputSchema: { path: z.string().optional().describe('相对 data/ 的路径，默认根目录') },
  },
  async ({ path: rel }) => {
    const entries = await fs.readdir(safeResolve(rel ?? '.'), { withFileTypes: true });
    return { content: [{ type: 'text' as const, text: entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n') }] };
  },
);

server.registerTool(
  'read_file',
  {
    description: '读取 data 目录下某个文本文件的内容',
    inputSchema: { path: z.string().describe('相对 data/ 的文件路径') },
  },
  async ({ path: rel }) => {
    const content = await fs.readFile(safeResolve(rel), 'utf-8');
    return { content: [{ type: 'text' as const, text: content.slice(0, 4000) }] };
  },
);

server.registerTool(
  'wc',
  {
    description: '统计某个文件的行数、词数、字节数',
    inputSchema: { path: z.string().describe('相对 data/ 的文件路径') },
  },
  async ({ path: rel }) => {
    const content = await fs.readFile(safeResolve(rel), 'utf-8');
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            path: rel,
            lines: content.split('\n').length,
            words: content.split(/\s+/).filter(Boolean).length,
            bytes: Buffer.byteLength(content),
          }),
        },
      ],
    };
  },
);

// stdio 传输：SDK 版的"stdout 只走协议、日志走 stderr"同样成立
await server.connect(new StdioServerTransport());
process.stderr.write('[sdk-fs-server] 已启动（与 raw-fs-server 工具清单完全相同）\n');
