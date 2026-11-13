/**
 * ============================================================
 * 17 — pgvector（向量存储）· 把向量检索从内存数组搬进数据库
 * 对照场景: 12-rag 的"内存数组 + 全量 cosine"索引层
 * ============================================================
 *
 * 回答的问题：12 例里向量存在内存数组、检索靠全量遍历——demo 能跑，
 * 但进程一退向量就没了；文档到几万条，全量精确 cosine 也要上百毫秒。
 * pgvector 给 PostgreSQL 加一种 vector 列类型 + 距离算子 + ANN 索引，
 * 向量和业务数据放同一张表、同一个事务、同一套 SQL——向量库选型里
 * 运维成本最低的一档（对照: Milvus/Qdrant 专用库，ES 全文+向量全家桶）。
 *
 * 本例完整走一遍"建表 → embed 入库 → 余弦 TopK → HNSW 索引"：
 *   ① 建表: emb vector(1024) —— 维度必须与 embedding 模型输出一致，
 *      维度不匹配的向量 INSERT 直接被类型系统拒绝（本例现场演示报错）
 *   ② 入库: 文本批量过 embedding 模型 → number[] → '[0.1,0.2,...]'
 *      字符串作为 $2 参数传入。注意 encoding_format:'float'——openai SDK
 *      v6 默认发 base64，Xinference 不支持会静默解出全零向量（12 例的坑）
 *   ③ 查询: 查询文本同样 embed → ORDER BY emb <=> $1 LIMIT k。
 *      <=> 是余弦距离（1 - 余弦相似度），越小越近；参数化传向量，
 *      生产代码永远不要把向量拼进 SQL 字符串
 *   ④ 索引: 数据量小时 planner 走全表精确扫描（更快且零损失）；
 *      CREATE INDEX ... USING hnsw 建好后，查询 SQL 一字不改，
 *      数据量上来自动切换到 ANN 近似检索——检索层可平滑升级
 *
 * 与 12 例的对照：检索管道（改写/召回/RRF/精排）一行不动，只把
 * "存数组 + 遍历算 cosine"换成 "INSERT + <=> 查询"——RAG 工程里
 * "检索层可替换"的现实意义。手写 BM25 教学归 12 例，生产关键词路
 * 用 ES/PG 全文索引，向量路用 pgvector/专用向量库，道理相同。
 *
 * 前置: brew install pgvector postgresql@18
 *       brew services start postgresql@18   # 扩展由本例自动 CREATE
 * 运行: npx tsx 17-pgvector/index.ts
 * 可选: PGHOST/PGPORT/PGUSER/PGDATABASE  连接参数（默认 localhost:5432/hale/postgres）
 *       EMBED_MODEL  默认 Qwen3-Embedding-8B（与 12 相同）
 *       EMBED_DIM    默认 1024（Qwen3 靠 MRL 从原生 4096 截断；须与建表一致）
 */

import OpenAI from 'openai';
import pg from 'pg';

// ── embedding 服务（与 12 相同的 Xinference 配置）──────────────────────
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://10.56.88.230:9998/v1',
  apiKey: process.env.OPENAI_API_KEY ?? 'local',
  timeout: 120_000,
});
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'Qwen3-Embedding-8B';
/** 建表维度。必须与 embedding 输出一致：Qwen3 原生 4096，MRL 截断到 1024 */
const EMBED_DIM = Number(process.env.EMBED_DIM ?? 1024);

// ── PostgreSQL 连接（brew postgresql@18 默认：本机 + 当前用户 + 免密）──
const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'hale',
  database: process.env.PGDATABASE ?? 'postgres',
});

/** number[] → '[0.1,0.2,...]'。PG 参数协议只传文本，pgvector 负责解析成向量 */
const toVec = (v: number[]) => `[${v.join(',')}]`;

/** 批量 embed（与 12 相同：必须显式 float，否则 Xinference 全零向量） */
async function embed(texts: string[]): Promise<number[][]> {
  const r = await client.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
    encoding_format: 'float',
    dimensions: EMBED_DIM, // MRL 截断，与建表维度对齐
  });
  return r.data.map((d) => d.embedding);
}

/** 语料：退款/账户/物流三簇 + 若干独立问题，让 TopK 排名有区分度 */
const CORPUS = [
  '如何申请退款？',
  '退款一般 3-5 个工作日原路退回。',
  '已发货的订单不能拒收退款。',
  '忘记密码了如何重置？',
  '如何注销账户？',
  '怎么修改收货地址？',
  '发货后一般 2-3 天送达。',
  '会员套餐的价格是多少？',
  '支持哪些支付方式？',
  '发票抬头可以修改吗？',
];

/** 查询一：与"退款 3-5 个工作日"零字面重合——关键词路无能为力，纯语义命中 */
const QUERIES = ['退货的钱什么时候到账', '开错了发票怎么改'];

async function main() {
  // ── ① 建扩展与表（幂等：重跑重置 docs 表，含此前手动插入的测试行）──
  console.log('\n════ ① 建扩展与表 ════');
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query('DROP TABLE IF EXISTS docs');
  await pool.query(`
    CREATE TABLE docs (
      id   bigserial PRIMARY KEY,
      text text NOT NULL,
      emb  vector(${EMBED_DIM})          -- 维度写死在类型里，错配数据插不进来
    )`);
  console.log(`CREATE EXTENSION vector / TABLE docs (emb vector(${EMBED_DIM})) — OK`);

  // ── ② embed 语料并入库 ─────────────────────────────────────────────
  console.log('\n════ ② embed 语料并入库 ════');
  const vectors = await embed(CORPUS);
  for (let i = 0; i < CORPUS.length; i++) {
    // 参数化 INSERT：向量以文本参数传入，pgvector 在服务端解析
    // （生产批量写入：unnest($1::text[], $2::vector[]) 一次提交或走 COPY）
    await pool.query('INSERT INTO docs (text, emb) VALUES ($1, $2)', [CORPUS[i], toVec(vectors[i])]);
  }
  console.log(`入库 ${CORPUS.length} 条，每条 ${vectors[0].length} 维`);

  // 防御演示：维度不匹配的向量被类型系统直接拒绝——建表维度不是摆设
  try {
    await pool.query('INSERT INTO docs (text, emb) VALUES ($1, $2)', ['坏数据', '[1,2,3]']);
  } catch (e) {
    console.log(`维度校验拦截 3 维向量 → ${(e as Error).message.split('\n')[0]}`);
  }

  // ── ③ 语义 TopK 查询 ───────────────────────────────────────────────
  for (const q of QUERIES) {
    console.log(`\n════ ③ 查询: "${q}" ════`);
    const qv = toVec((await embed([q]))[0]);
    const { rows } = await pool.query(
      `SELECT id, text,
              round((emb <=> $1)::numeric, 4) AS cos_dist,   -- 余弦距离，越小越近
              round((1 - (emb <=> $1))::numeric, 4) AS score  -- 反算相似度给人看
       FROM docs
       ORDER BY emb <=> $1
       LIMIT 3`,
      [qv],
    );
    for (const r of rows) console.log(`  #${r.id}  dist=${r.cos_dist}  score=${r.score}  ${r.text}`);
  }

  // ── ④ HNSW 索引与查询计划 ──────────────────────────────────────────
  console.log('\n════ ④ HNSW 索引 ════');
  // 余弦场景配套 vector_cosine_ops——算子 <=> 与索引 opclass 必须一致，否则索引不生效
  await pool.query('CREATE INDEX IF NOT EXISTS docs_emb_hnsw ON docs USING hnsw (emb vector_cosine_ops)');
  console.log('CREATE INDEX docs_emb_hnsw USING hnsw (emb vector_cosine_ops) — OK');

  // 看 planner 怎么选：小数据全表精确扫描更快；同一 SQL 在大数据量自动走 ANN
  const qv = toVec((await embed([QUERIES[0]]))[0]);
  const c = await pool.connect(); // SET 是会话级，独占一个连接演示
  try {
    const seq = await c.query('EXPLAIN (COSTS OFF) SELECT id FROM docs ORDER BY emb <=> $1 LIMIT 3', [qv]);
    console.log('\n默认计划（10 行数据 → 全表精确扫描）:');
  // EXPLAIN 会把 1024 维向量全文打进计划文本，清洗后再打印
  const cleanPlan = (s: string) => s.replace(/\[[^[\]]{50,}\]/g, '[…1024 维向量…]');
  for (const r of seq.rows) console.log('  ' + cleanPlan(r['QUERY PLAN']));
  await c.query('SET enable_seqscan = off'); // 强制看索引路径，仅演示用
  const idx = await c.query('EXPLAIN (COSTS OFF) SELECT id FROM docs ORDER BY emb <=> $1 LIMIT 3', [qv]);
  console.log('\n禁用顺序扫描后（同一 SQL 走 HNSW 近似检索）:');
  for (const r of idx.rows) console.log('  ' + cleanPlan(r['QUERY PLAN']));
  } finally {
    await c.query('RESET enable_seqscan').catch(() => {});
    c.release();
  }

  console.log(
    '\n说明: 表已留在库里——用 TablePlus 连 postgresql://hale@localhost:5432/postgres\n' +
      '      可继续查看/查询 docs；生产代码只需 ③ 里的参数化模板。',
  );
}

main()
  .catch((e) => {
    console.error('\n运行失败:', e.message);
    if (/ECONNREFUSED|connect/i.test(e.message)) {
      console.error('提示: PostgreSQL 未启动？  brew services start postgresql@18');
    }
    process.exitCode = 1;
  })
  .finally(() => pool.end());
