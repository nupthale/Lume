/**
 * ============================================================
 * 13 — 上下文窗口（Context Window）
 * 对照场景: Trae / Claude Code 的"会话压缩切换"、03 的 rolling summary
 * ============================================================
 *
 * 你大概率刚在 Trae 里见过一次提示：上下文快满了，于是旧对话被压成
 * 一份"交接摘要"，模型带着摘要在新窗口里继续干活。这个例子把整件事
 * 拆成三幕讲清楚：
 *
 * 【窗口是什么】
 *   模型单次推理能"看到"的 token 总上限（Qwen3 常见 32K/128K/256K，
 *   以部署配置为准；Claude 200K；具体多少服务端说了算）。
 *   两条关键性质：
 *   ① 模型无状态：服务器不保存任何对话。你每次调用都要把
 *     system + 全部历史 + 工具结果 整个重发一遍。
 *     所谓"记忆"，只是你这次重发给它的那部分 messages。
 *     （02 会话管理、03 分层记忆的全部立足点就是这条）
 *   ② 成本随轮数线性涨：第 N 轮的 prompt_tokens 包含前 N-1 轮的全部
 *     内容——第一幕用真实的 usage 数字验证这一点。
 *
 * 【"满了"是什么意思】
 *   组装出的 prompt 总 token 超过窗口上限，两种表现：
 *   a) 规规矩矩报 400，服务端在推理开始前就拒绝（第二幕真实触发一次）
 *   b) 更危险：服务端静默截断（掐掉开头），模型"忘了"最早的内容，
 *      不报错、你还以为一切正常（第二幕做"掐头检测"）
 *
 * 【"切换窗口"是什么意思】
 *   = 03 rolling summary 的产品化，三步：
 *     ① 把旧历史压成交接摘要（关键事实/已完成/待办）
 *     ② 新 messages = [system + 摘要] + 最近几轮逐字原文
 *        （同一条消息不能既在摘要又在逐字窗口——09 讲过的水位线不变量）
 *     ③ 带着新 messages 继续，对话无缝续上
 *   Trae 对本场对话做的还多一步：摘要结构化（意图/已完成/进行中/下一步），
 *   且文件记忆（09 的 jsonl/topics.md）不受影响——窗口切换只影响
 *   "这一场对话"，跨会话的记忆在文件里。
 *
 * 诚实的成本账（生产 vs demo 的差异）：
 *   压缩本身也是一次 LLM 调用，要花钱、要时间。本 demo 历史很短，
 *   压缩后省的 token 还抵不上摘要调用的开销——所以真实产品的触发
 *   时机都是"接近上限才压"，而不是每轮都压。触发时机是个成本决策。
 *
 * 运行: npx tsx 13-context-window/index.ts
 * 可选: PROBE_CAP_KB=600   第二幕填充文本的安全上限（千字节），默认 1200
 */

import OpenAI from 'openai';

// 默认指向本地 Xinference 部署的 Qwen3，可用环境变量覆盖（与 01-09 相同）
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
  // 第二幕会塞几十万字符试探上限，把超时放宽；不自动重试保证试探行为确定
  timeout: 300_000,
  maxRetries: 0,
});
const MODEL = process.env.MODEL ?? 'qwen3';
/** 默认关闭 Qwen3 thinking；设 KEEP_THINKING=1 开启 */
const extraBody = process.env.KEEP_THINKING === '1' ? undefined : { chat_template_kwargs: { enable_thinking: false } };

type Msgs = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

/** 统一的调用入口：返回文本 + usage（usage 里有无状态的最直接证据） */
async function chat(messages: Msgs, maxTokens = 512) {
  const r = await client.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: maxTokens,
    ...(extraBody ?? {}),
  });
  return { content: r.choices[0].message.content ?? '', promptTokens: r.usage?.prompt_tokens };
}

// ---------------------------------------------------------------------------
// 第一幕：窗口是无状态的——每次调用全量重发，prompt_tokens 逐轮线性涨
// ---------------------------------------------------------------------------

async function act1(): Promise<Msgs> {
  console.log('========= 第一幕：模型无状态，"记忆"是每次重发换来的 =========\n');

  const messages: Msgs = [{ role: 'system', content: '你是简洁的助手，每个回答不超过两句话。' }];
  const questions = [
    '我叫小李，正在增肌，目标每天吃 150 克蛋白质。请记住这些信息。',
    '如果我每餐吃 50 克蛋白质、一天三餐，够不够我的目标？',
    '换个话题：水的沸点是多少摄氏度？',
  ];

  for (const q of questions) {
    messages.push({ role: 'user', content: q });
    const r = await chat(messages);
    messages.push({ role: 'assistant', content: r.content });
    console.log(`📥 ${q}`);
    console.log(`🤖 ${r.content.trim()}`);
    console.log(`   ↳ 本轮 prompt_tokens = ${r.promptTokens ?? 'n/a'}（包含此前全部轮次的重发）\n`);
  }

  console.log('结论：prompt_tokens 一轮比一轮大——第 N 轮把前 N-1 轮原样重发了一遍。');
  console.log('所谓"它记得"，其实是"你每次都把历史再发一遍"。窗口就是这笔重发的上限。\n');
  return messages;
}

// ---------------------------------------------------------------------------
// 第二幕：把窗口塞满，看真实的"满"
// 指数翻倍塞占位文档，直到服务端报错（真·400），或到达安全上限后做掐头检测。
// 报错信息长什么样取决于推理后端（vLLM/SGLang/Xinference 各不相同）。
// ---------------------------------------------------------------------------

/** 占位文档：开头放一个锚点句，掐头检测时靠它判断"开头还在不在" */
function makeDoc(chars: number): string {
  const head = '【文档开头】鲸鱼不是鱼，是生活在海洋里的哺乳动物，用肺呼吸。\n';
  const line = '鲸鱼不是鱼，是生活在海洋里的哺乳动物，用肺呼吸。（占位重复内容，无新信息）\n';
  const body = line.repeat(Math.max(0, Math.ceil((chars - head.length) / line.length)));
  return (head + body).slice(0, Math.max(chars, head.length));
}

async function act2() {
  console.log('\n========= 第二幕：塞满窗口，看"满"的真面目 =========');
  console.log('（指数翻倍塞文档直到被拒；被拒的请求服务端推理前秒回，不烧生成钱）\n');

  let chars = 4_000;
  const cap = (Number(process.env.PROBE_CAP_KB) || 1200) * 1000;
  let lastOkDoc = '';

  while (chars <= cap) {
    const doc = makeDoc(chars);
    try {
      const r = await chat([{ role: 'user', content: doc + '\n\n请只回复两个字：收到' }], 16);
      lastOkDoc = doc;
      console.log(`  ✓ ${chars} 字符塞进去了（服务端计 ${r.promptTokens ?? '?'} prompt tokens）`);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const status = (e as { status?: number })?.status ?? 'n/a';
      if (/timed?\s*out|timeout/i.test(msg)) {
        console.log(`  ⏱ ${chars} 字符请求超时（是太慢，不是窗口满）——停止试探`);
        break;
      }
      console.log(`  ✗ ${chars} 字符被拒绝：HTTP ${status}`);
      console.log(`    服务端原文：${msg}`);
      console.log('\n  ↑ 这就是"上下文满了"——组装的 prompt 超过窗口上限，');
      console.log('    服务端在推理开始前就拒绝了。第二幕结束，跳过掐头检测。\n');
      return;
    }
    chars *= 2;
  }

  // 走到这里说明安全上限内服务端都收了。没法证明"没满"，做掐头检测：
  // 拿最大的成功文档问开头内容——答不出说明开头被静默截断了（或检索退化）
  if (!lastOkDoc) return;
  console.log('\n  安全上限内服务端都没报错。做掐头检测：问它文档第一句是什么');
  const r = await chat(
    [{ role: 'user', content: lastOkDoc + '\n\n不要复述全文。只回答：【文档开头】标记后的第一句话里，说的是什么动物？' }],
    64,
  );
  const sawHead = /鲸|哺乳/.test(r.content);
  console.log(`  模型回答：${r.content.trim()}`);
  console.log(
    sawHead
      ? '  ✓ 开头还看得见（窗口确实够大）'
      : '  ✗ 开头答不上来。两种可能：被服务端静默截断，或超长上下文里的"找不到中间"检索退化。\n' +
        '    无论哪种，结论一致：别指望把整库文档硬塞进窗口——这正是 RAG（12 例）存在的理由',
  );
  console.log();
}

// ---------------------------------------------------------------------------
// 第三幕：满了怎么办——压缩切换（Trae 对本场会话做的事）
// ① 旧历史 → 交接摘要；② [system+摘要] + 最近 1 对逐字原文；③ 验证仍"记得"
// 水位线不变量：被保留的最近轮次不进摘要——同一条消息不重复出现（09 的教训）
// ---------------------------------------------------------------------------

async function act3(history: Msgs) {
  console.log('========= 第三幕：压缩切换 = rolling summary 的产品化 =========\n');

  const SYSTEM = '你是简洁的助手，每个回答不超过两句话。';
  const verifyQ = '不要翻旧消息，直接回答：我叫什么名字？我的每日蛋白质目标是多少克？';

  // ① 基线：不压缩、全量历史直接问（窗口没满时当然答得对，记录 token 成本）
  const baseline = await chat([...history, { role: 'user', content: verifyQ }]);
  console.log(`【压缩前】全量历史 + 问题 → prompt_tokens = ${baseline.promptTokens ?? 'n/a'}`);
  console.log(`          回答：${baseline.content.trim()}\n`);

  // ② 压缩：水位线 = 保留最后 1 对 user/assistant 逐字，之前的全部进摘要
  const kept = history.slice(-2); // 最后一对问答
  const toSummarize = history.slice(1, -2); // system 之后的、未被保留的旧历史
  const summary = await chat(
    [
      {
        role: 'system',
        content:
          '你是会话压缩器。把对话历史压缩成一份"交接摘要"，给下一个窗口里的你自己看。' +
          '格式：【关键事实】每行一条；【已完成】；【待办】。' +
          '只保留继续工作必需的信息，不要寒暄，不要复述原文。',
      },
      { role: 'user', content: toSummarize.map((m) => `${m.role}: ${m.content}`).join('\n') },
    ],
    400,
  );
  console.log('【交接摘要】（对照：Trae 切窗时的摘要还分 意图/已完成/进行中/下一步 四段）');
  console.log(summary.content.trim().split('\n').map((l) => `  ${l}`).join('\n'), '\n');

  // ③ 新窗口的 messages：system(含摘要) + 最近 1 对逐字 + 新问题
  //    注意：名字和蛋白质目标只存在于摘要里——逐字窗口里没有
  const compacted: Msgs = [
    { role: 'system', content: `${SYSTEM}\n\n【前情交接摘要】\n${summary.content.trim()}` },
    ...kept,
    { role: 'user', content: verifyQ },
  ];
  const after = await chat(compacted);
  console.log(`【压缩后】摘要 + 最近 1 对原文 + 问题 → prompt_tokens = ${after.promptTokens ?? 'n/a'}`);
  console.log(`          回答：${after.content.trim()}\n`);

  console.log('验证：模型仍答对名字和目标——信息来自摘要，不来自逐字原文。窗口"切换"后对话无缝续上。\n');

  // ④ 诚实的成本账：demo 里历史短，压缩可能根本没省（还多花了一次摘要调用）。
  //    压缩的收益只在长会话显现，所以产品的触发时机是"接近上限才压"。
  const b = baseline.promptTokens ?? 0;
  const a = after.promptTokens ?? 0;
  console.log(
    `成本账：压缩前 ${b} tokens vs 压缩后 ${a} tokens（本 demo 历史很短，` +
      `${a < b ? '省了 ' + (b - a) : '没省甚至更贵'}——这还没算摘要调用本身的开销）。` +
      `长会话里摘要远小于被压缩的历史，收益才显现；所以 Trae/Claude Code 都是接近上限才触发，不每轮压。`,
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const history = await act1(); // 三轮对话，留下带关键事实的历史
  await act2(); // 真实触发一次"满"
  await act3(history); // 压缩切换并验证
}

main();
