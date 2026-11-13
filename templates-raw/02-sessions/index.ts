/**
 * ============================================================
 * 02 — 多用户、多会话的 messages 管理
 * 对照场景: templates/template-docs-chatbot 等所有带 chat 的模板
 * ============================================================
 *
 * 问题 1 的回答：不同用户会话如何区分管理？
 *
 * 关键设计（Mastra / OpenAI Assistants API / LangGraph 全是同一套）：
 *
 *   resourceId（用户） ─┬─ threadId/sessionId（会话 A）─ messages[]
 *                      └─ threadId/sessionId（会话 B）─ messages[]
 *
 *  - "用户" 和 "会话" 是两个维度：一个用户可以同时开多个会话
 *    （浏览器多 tab、微信群 vs 私聊）
 *  - 每个会话就是 01 例子里那个 messages 数组，仅此而已
 *  - 唯一需要你做的事：请求进来时带上 (resourceId, threadId)，
 *    取出对应的 messages，追加，写回去
 *  - 持久化 = 把这些数组存起来（内存 / 文件 / 数据库），
 *    进程重启后还能取回
 *
 * 另一个生产必备点：上下文裁剪（trim）。
 * messages 不能无限增长——上下文窗口有限、token 费用线性上涨。
 * 常见策略：保留 system + 最近 N 条，更早的内容靠 03 例子的"记忆"补偿。
 *
 * 运行: npx tsx 02-sessions/index.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

// ---------------------------------------------------------------------------
// SessionManager：管理 (resourceId, threadId) → messages 的映射
// 这就是 Mastra 里 Memory + Storage 帮你做的事的骨架
// ---------------------------------------------------------------------------

class SessionManager {
  private sessions = new Map<string, Messages>(); // key = "resourceId:threadId"
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.loadAll(); // 启动时从磁盘恢复 → "持久化"
  }

  private key(resourceId: string, threadId: string) {
    return `${resourceId}:${threadId}`;
  }

  /** 每个会话一个 JSON 文件：.data/{resourceId}/{threadId}.json */
  private fileFor(resourceId: string, threadId: string) {
    return path.join(this.dataDir, resourceId, `${threadId}.json`);
  }

  private loadAll() {
    if (!fs.existsSync(this.dataDir)) return;
    for (const resourceDir of fs.readdirSync(this.dataDir)) {
      for (const f of fs.readdirSync(path.join(this.dataDir, resourceDir))) {
        const [resourceId, threadId] = [resourceDir, f.replace('.json', '')];
        this.sessions.set(
          this.key(resourceId, threadId),
          JSON.parse(fs.readFileSync(this.fileFor(resourceId, threadId), 'utf-8')),
        );
      }
    }
  }

  getMessages(resourceId: string, threadId: string): Messages {
    // 惰性创建：新会话自动初始化为只有 system prompt
    const key = this.key(resourceId, threadId);
    if (!this.sessions.has(key)) {
      this.sessions.set(key, [
        { role: 'system', content: '你是一个简洁的助手。' },
      ]);
    }
    return this.sessions.get(key)!;
  }

  append(resourceId: string, threadId: string, message: Messages[number]) {
    this.getMessages(resourceId, threadId).push(message);
    this.persist(resourceId, threadId);
  }

  /** 列出所有会话（用于观测） */
  listSessions(): Array<{ key: string; messageCount: number }> {
    return [...this.sessions.entries()].map(([key, msgs]) => ({ key, messageCount: msgs.length }));
  }

  private persist(resourceId: string, threadId: string) {
    const file = this.fileFor(resourceId, threadId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(this.sessions.get(this.key(resourceId, threadId))));
  }

  /**
   * 上下文裁剪：发给模型前把 messages 压到合理大小。
   * 策略：system 永远保留（它是行为指令），只保留最近 maxMessages 条。
   * ⚠️ 注意：tool 消息必须和它所属的 assistant(tool_calls) 消息成对保留，
   * 从中间切断会直接报 API 错误——生产实现要从"安全切割点"开始截断
   */
  trim(messages: Messages, maxMessages = 8): Messages {
    const system = messages.filter((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');
    return [...system, ...rest.slice(-maxMessages)];
  }
}

// ---------------------------------------------------------------------------
// 模拟一个 chat 服务端处理函数
// ---------------------------------------------------------------------------

const manager = new SessionManager(path.join(import.meta.dirname, '.data'));

async function handleChat(resourceId: string, threadId: string, userMessage: string) {
  console.log(`\n📥 [${resourceId} / ${threadId}] 用户: ${userMessage}`);

  // 取出该会话的 messages → 追加用户输入 → 裁剪 → 调模型
  const messages = manager.getMessages(resourceId, threadId);
  manager.append(resourceId, threadId, { role: 'user', content: userMessage });

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: manager.trim(messages),
    ...(extraBody ?? {}),
  });

  const reply = response.choices[0].message.content ?? '';
  manager.append(resourceId, threadId, { role: 'assistant', content: reply });
  console.log(`🤖 回复: ${reply}`);
  return reply;
}

// ---------------------------------------------------------------------------
// 演示：两个用户、三个会话交错请求
// ---------------------------------------------------------------------------

async function main() {
  await handleChat('alice', 'session-1', '我叫 Alice，记住这个名字');
  await handleChat('bob', 'session-1', '我叫 Bob，记住这个名字');
  await handleChat('alice', 'session-2', '我叫什么名字？（这是另一个会话，我不记得）');
  await handleChat('alice', 'session-1', '我叫什么名字？（这是原会话，应该记得）');

  console.log('\n=== 会话隔离验证 ===');
  for (const { key, messageCount } of manager.listSessions()) {
    console.log(`${key}: ${messageCount} 条消息`);
  }

  console.log('\n💡 重新运行本文件，会话从磁盘恢复，alice/session-1 仍记得她的名字。');
  console.log('💡 这就是 Mastra Memory(threadId) + Storage 的骨架，加上 03 的分层记忆就是完整形态。');
}

main();
