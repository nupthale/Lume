/**
 * ============================================================
 * 04b — Human in the Loop 的生产形态：前端 confirm block
 * ============================================================
 *
 * index.ts 的局限：审批交互绑死在终端 readline 上。
 * 现实产品（Trae / Claude Code / Cursor）的形态是：
 *
 *   agent 后端 --结构化 JSON--> 前端渲染确认卡片 --点击事件--> 后端继续执行
 *
 * 核心洞察：requestApproval 的签名 Promise<boolean> 完全不变，
 * 变的只是"谁来 resolve 这个 Promise"：
 *   index.ts: 用户在终端敲 y/n   → stdin resolve
 *   web.ts:   用户在浏览器点按钮 → POST /approve 回调 resolve
 * agent loop 一行不用改 —— 这就是"工具执行点是天然暂停点"的意义。
 *
 * 通道设计（为什么不是后端直接 HTTP 调前端）：
 *   浏览器/IDE 前端是 client 角色，不监听端口，服务端无法主动连它。
 *   所以下行用 SSE（server → 前端推 approval_request），
 *   上行用 POST（前端 → server 回传审批结果）。
 *   Trae 中这两条通道是自定义协议的正反向消息，架构等价。
 *
 * ============================================================
 * 生产级怎么做？（本 demo 全局变量 pendingApproval 的局限与升级路径）
 * ============================================================
 *
 * 全局变量的四个致命问题：
 *   1. 水平扩展即失效：两个实例 behind LB，审批 POST 到 A，挂起的 Promise 在 B
 *   2. 并发 = 1：第二个用户的 resolve 会覆盖第一个
 *   3. 重启即丢失：进程崩溃，挂起中的审批永久卡死
 *   4. 无审计、无超时：谁批的、何时批的，无处可查
 *
 * 生产形态一：长驻 Agent Worker + 注册表路由（Trae / Claude Code 形态）
 *
 *   API 网关 ── Redis pub/sub ──┬─ worker 1 ─ Map<runId, resolver>
 *                              └─ worker 2 ─ Map<runId, resolver>
 *   真相源：DB 的 agent_runs 状态机
 *   (RUNNING → WAITING_APPROVAL → RUNNING / REJECTED / EXPIRED)
 *
 *   - worker 内存里仍有 Map<runId, resolver>，但它只是路由提示，不是真相源
 *   - 审批结果到达网关 → 查 DB 确认 run 处于 WAITING_APPROVAL →
 *     Redis pub/sub 按 sessionId 路由到持有它的 worker → 唤醒
 *   - worker 崩了也没关系：DB 里 run 还在 WAITING_APPROVAL，审批到达时
 *     任何活着的 worker 从 DB 加载 messages 重建上下文，从断点继续
 *     （这就是"事件溯源恢复"）
 *   - IDE 场景更简单：前端到后端是 WebSocket 长连接，天然粘性路由，
 *     连 pub/sub 都省了
 *
 * 生产形态二：Durable Workflow 引擎（Temporal / Step Functions / Mastra）
 *   - agent loop 写成 workflow，"等待审批"是一等公民原语（waitForSignal）
 *   - 引擎在每一步都把执行状态快照持久化（事件溯源），不是只在暂停点
 *   - worker 可以随便死，审批 signal 到达时引擎从快照重放恢复——
 *     await 的开发体验还在，底下根本不是挂着的 Promise，而是"杀掉再重放"
 *   - 超时、重试、幂等全是引擎内置
 *
 * 选型规律：审批等待是小时/天级（如飞书审批流）、实例随时伸缩 → 形态二；
 *           等待是秒/分钟级、连接粘性可控（IDE/WebSocket）→ 形态一够用。
 *
 * 审批本身也要持久化成表（pendingApproval 变量的对应物）：
 *   pending_approvals 表，一次挂起 = 一行记录：
 *     run_id / tool_call_id（关联到 messages 里的具体 tool call）
 *     payload（发给前端渲染 confirm block 的那个 JSON）
 *     status: PENDING → APPROVED | REJECTED | EXPIRED | SUPERSEDED
 *     deadline（超时自动拒绝）+ approver_id + decided_at（审计）
 *
 * 横切关注点（这些才是生产的大头）：
 *   - 幂等：用户狂点按钮/网络重试导致审批事件到达两次 → 按 tool_call_id 去重；
 *     "批准后、执行前"崩溃重启 → 恢复时要能区分"已批准未执行"和"已执行"
 *   - 权限：谁能批？只有 session owner 或 RBAC 对应角色；审批请求和结果
 *     都要带签名/鉴权，防止伪造审批结果直接唤醒敏感操作
 *   - 多级审批：金额超阈值走串行/并行多审批人 + quorum ——
 *     把 boolean 升级成一个小的子状态机
 *   - 审计：append-only 事件日志，谁在何时对哪个 tool call 做了什么决定
 *
 * 一句话总结：demo 里那行 resolve?.(approved) 在生产里的对应物是
 * "一行 pending_approvals 表记录 + 一个分布式路由机制 + 一套状态机"。
 * Promise 只是单机版的糖。
 *
 * 运行: npx tsx 04-hitl/web.ts
 * 然后浏览器打开 http://localhost:3456（打开后演示自动开始）
 */

import http from 'node:http';
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
// 工具定义与实现（与 index.ts 完全相同）
// ---------------------------------------------------------------------------

/** mock 订单库 */
const ORDERS: Record<string, { item: string; price: number; daysAgo: number }> = {
  '1001': { item: '无线耳机', price: 399, daysAgo: 3 },
  '1002': { item: '机械键盘', price: 899, daysAgo: 45 },
  '1003': { item: '手机壳', price: 39, daysAgo: 1 },
};

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_order',
      description: '查询订单详情',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'process_refund',
      description: '执行退款（敏感操作，需要人工审批）。仅支持 30 天内的订单。',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
        required: ['orderId', 'amount'],
      },
    },
  },
];

/** 敏感操作白名单：在这里面的工具执行前要过人工 */
const APPROVAL_REQUIRED = new Set(['process_refund']);

/** mock 退款执行 */
function doRefund(orderId: string, amount: number) {
  return { success: true, orderId, amount, refundId: `RF-${Date.now()}` };
}

// ---------------------------------------------------------------------------
// 前端通道：SSE 下行 + POST 上行
// ---------------------------------------------------------------------------

/** 已连接的浏览器（SSE 长连接）。生产里按 sessionId 隔离 */
const sseClients = new Set<http.ServerResponse>();
let onFirstClient: () => void = () => {};
/** 等第一个前端连上再开始演示，否则审批卡片没人看 */
const clientReady = new Promise<void>((r) => (onFirstClient = r));

/** 后端 → 前端：推结构化 JSON 消息（agent 的全部输出也走这条通道） */
function push(msg: Record<string, unknown>) {
  for (const res of sseClients) res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

/** 终端 + 页面双写，方便观察 */
function log(text: string) {
  console.log(text);
  push({ type: 'log', text });
}

// ---------------------------------------------------------------------------
// 审批门：与 index.ts 同签名，resolve 源从 stdin 换成 HTTP 回调
// ---------------------------------------------------------------------------

/** 挂起中的审批（单进程 demo 版）。生产对应物见文件头"生产级怎么做"：
 *  一行 pending_approvals 表记录 + 分布式路由 + 状态机，Promise 只是单机版的糖 */
let pendingApproval: ((approved: boolean) => void) | null = null;

function requestApproval(tool: string, args: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApproval = resolve; // 存下 resolver，等 POST /approve 来触发
    push({ type: 'approval_request', tool, args }); // ← 发给前端渲染 confirm block
  });
  // 对比 index.ts：唯一区别是 resolve 的触发源。
  // 那边 await rl.question()，这边 await 网络回调 —— agent loop 无感知。
}

// ---------------------------------------------------------------------------
// agent loop（与 index.ts 相同，只是 console.log 换成双写的 log）
// ---------------------------------------------------------------------------

async function runAgent(messages: Messages) {
  let step = 0;
  while (true) {
    if (++step > 10) throw new Error('超过最大步数'); // 任何循环都要有预算

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      ...(extraBody ?? {}),
    });
    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      push({ type: 'assistant', text: msg.content ?? '' });
      return;
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      const args = JSON.parse(call.function.arguments);
      log(`🔧 工具调用: ${call.function.name} ${call.function.arguments}`);

      if (APPROVAL_REQUIRED.has(call.function.name)) {
        // === 暂停点 ===
        // Promise 在这里挂起，进程活着但 loop 不动。
        // 因为 server 是长驻进程，await 挂着就行（Trae 的 agent 进程同理）；
        // 只有 serverless 架构才需要"存库 + return + 回调时恢复"那套。
        log(`⏸️  暂停点：等待前端审批 ${call.function.name}...`);
        const approved = await requestApproval(call.function.name, args);

        if (!approved) {
          // 拒绝也是信息：喂回模型，让它改用别的方案
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: 'REJECTED_BY_HUMAN', reason: '审批人拒绝此次退款' }),
          });
          continue;
        }
      }

      // 正常执行
      const result =
        call.function.name === 'lookup_order'
          ? ORDERS[args.orderId] ?? { error: '订单不存在' }
          : doRefund(args.orderId, args.amount);

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      log(`✅ 结果: ${JSON.stringify(result)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP server：静态页 / SSE 下行 / 审批上行
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  } else if (req.method === 'GET' && req.url === '/events') {
    // SSE 下行通道
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    sseClients.add(res);
    onFirstClient();
    req.on('close', () => sseClients.delete(res));
  } else if (req.method === 'POST' && req.url === '/approve') {
    // 审批上行通道：用户点击按钮 → 前端 fetch 到这里 → 唤醒暂停点
    readBody(req).then((body) => {
      const { approved } = JSON.parse(body) as { approved: boolean };
      const resolve = pendingApproval;
      pendingApproval = null;
      resolve?.(approved); // ← agent loop 在这里被唤醒，从 await 处继续跑
      push({ type: 'approval_result', approved });
      res.writeHead(200);
      res.end('ok');
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ---------------------------------------------------------------------------
// 前端页面（内嵌保持单文件可跑）
// ---------------------------------------------------------------------------

const HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>HITL 审批台 — 客服退款 Agent</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", sans-serif; max-width: 680px; margin: 32px auto; padding: 0 16px; background: #f6f7f9; color: #1f2328; }
  h2 { font-size: 18px; }
  #feed { display: flex; flex-direction: column; gap: 10px; }
  .log { font-size: 13px; color: #57606a; font-family: ui-monospace, monospace; padding: 2px 10px; }
  .assistant { background: #fff; border: 1px solid #e6e8eb; border-radius: 12px; padding: 12px 16px; font-size: 14px; white-space: pre-wrap; }
  .card { background: #fff; border: 1px solid #f0c36d; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .card .title { font-weight: 600; margin-bottom: 8px; }
  .card pre { background: #f6f8fa; border-radius: 8px; padding: 10px; font-size: 12px; overflow: auto; margin: 8px 0 0; }
  .card button { border: 0; border-radius: 8px; padding: 8px 18px; font-size: 14px; color: #fff; cursor: pointer; margin: 12px 8px 0 0; }
  .card button:disabled { opacity: .5; cursor: default; }
  .approve { background: #1a7f37; }
  .deny { background: #cf222e; }
  .verdict { margin-left: 8px; font-size: 13px; color: #57606a; }
</style>
</head>
<body>
<h2>客服退款 Agent <small style="font-weight:400;color:#57606a">— 敏感操作需要你审批</small></h2>
<div id="feed"></div>
<script>
var feed = document.getElementById('feed');
var es = new EventSource('/events');
es.onmessage = function (e) {
  var m = JSON.parse(e.data);
  if (m.type === 'log') { addLog(m.text); }
  else if (m.type === 'assistant') { addAssistant(m.text); }
  else if (m.type === 'approval_request') { showCard(m); }
  else if (m.type === 'approval_result') { addLog(m.approved ? '✅ 已批准，agent loop 从暂停点继续' : '❌ 已拒绝，拒绝原因作为 tool result 喂回模型'); }
};
function addLog(text) {
  var d = document.createElement('div'); d.className = 'log'; d.textContent = text; feed.appendChild(d);
}
function addAssistant(text) {
  var d = document.createElement('div'); d.className = 'assistant'; d.textContent = '🤖 ' + text; feed.appendChild(d);
}
function showCard(m) {
  // 这就是 confirm block：结构化 JSON → 渲染成卡片 + 按钮
  var card = document.createElement('div'); card.className = 'card';
  var amount = (m.args && m.args.amount != null) ? m.args.amount : 'N/A';
  card.innerHTML =
    '<div class="title">⚠️ 需要人工审批</div>' +
    '<div>工具: <b>' + m.tool + '</b>　金额: ¥' + amount + '</div>' +
    '<pre>' + JSON.stringify(m.args, null, 2) + '</pre>';
  var ok = document.createElement('button'); ok.className = 'approve'; ok.textContent = '批准';
  var no = document.createElement('button'); no.className = 'deny'; no.textContent = '拒绝';
  ok.onclick = function () { reply(card, true); };
  no.onclick = function () { reply(card, false); };
  card.appendChild(ok); card.appendChild(no);
  feed.appendChild(card);
}
function reply(card, approved) {
  card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  var v = document.createElement('span'); v.className = 'verdict';
  v.textContent = approved ? '→ 已批准' : '→ 已拒绝';
  card.appendChild(v);
  fetch('/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: approved }) });
}
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

const SYSTEM =
  '你是客服 agent。处理退款时：先查订单；订单超 30 天或用户拒绝审批时，' +
  '礼貌说明并给出替代方案（如优惠券）。不要重复请求被拒绝的退款。';

async function main() {
  server.listen(3456, async () => {
    console.log('审批台已启动: http://localhost:3456 （浏览器打开后演示自动开始）\n');
    await clientReady; // 前端连上才开始，否则卡片没人点

    log('场景 1：订单 1001 耳机退款 —— 试试点【批准】');
    await runAgent([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: '我的订单 1001 耳机有杂音，想退款' },
    ]);

    log('—— 场景 2：订单 1002 键盘 —— 试试点【拒绝】，看模型如何改口 ——');
    await runAgent([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: '订单 1002 键盘我想退货退款' },
    ]);

    log('演示结束，可以 Ctrl+C 退出。');
  });
}

main();
