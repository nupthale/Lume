# templates-raw — 裸 SDK 学 Agent 开发

用 OpenAI SDK（无任何 agent 框架）实现 Mastra `templates/` 里的经典场景，
每个例子回答一个核心问题。所有例子都是单文件、可直接运行的教学实现。

> 原则：先看懂这些文件，再回头看 Mastra——你会发现框架只是把这些循环
> 包装成了 `new Agent({ ... })`。

## 运行

**默认已指向本地 Xinference 的 Qwen3 服务（`http://10.56.88.230:9998`），零配置直接跑：**

```bash
cd templates-raw
pnpm install --ignore-workspace   # ⚠️ 必须加 --ignore-workspace，否则 pnpm 会向上找到 monorepo 根做全量安装

pnpm agent-loop   # 01
pnpm sessions     # 02
pnpm memory       # 03
pnpm hitl         # 04（终端交互，会问你 y/n）
pnpm harness      # 05
pnpm full-agent   # 06（真实联网：抓 Bing 搜索 + 网页正文）
pnpm multi-agent  # 07（主管 + 调研员/预算师，orchestrator-worker）
pnpm parallel-agents # 08（fan-out/fan-in：三城调研并行跑）
pnpm file-memory # 09（Trae 式文件记忆：日期目录 + session jsonl + topics.md 两级钻取）
pnpm streaming   # 10（流式：打字机效果 + tool call 参数边流边攒 + 指数退避）
pnpm evals       # 11（评测：黄金集 + LLM-as-judge + 轨迹检查 + span 记账）
pnpm rag         # 12（RAG：切块 → embedding → 混合检索 → 带引用回答 + 引用校验）
pnpm context-window # 13（上下文窗口：无状态全量重发 → 真实塞满触发 400 → 压缩切换续上对话）
pnpm compaction   # 14（生产级压缩时机：预算→切点→水位线，三时机口诀，大多数轮零压缩）
pnpm skills       # 15（Agent Skills：SKILL.md 渐进式披露——目录常驻、按需加载全文、脚本第三层；附 token 结算）
pnpm mcp          # 16（MCP：工具外部化——手写 JSON-RPC 协议三幕剧 + 官方 SDK 双向互通）
```

### 可选环境变量（都有合理默认值）

```bash
export OPENAI_BASE_URL=...   # 默认 http://10.56.88.230:9998/v1（Xinference OpenAI 兼容端点）
export MODEL=...             # 默认 qwen3（模型名以 /v1/models 返回为准）
export OPENAI_API_KEY=...    # 默认 local（本地服务不校验，SDK 要求非空）
export KEEP_THINKING=1       # 默认关闭 Qwen3 thinking；设此变量开启观察区别
export NO_EMBED=1            # 03 专用：默认用 Qwen3-Embedding-8B 做语义检索，设此变量退回关键词检索
export BUDGET_1=3000 BUDGET_2=220  # 14 专用：两阶段 token 预算，调小看压缩更早触发
```

Qwen3 thinking 关闭原理：openai SDK v6 没有 `extra_body`，未知字段会直接作为
请求体顶层属性透传，所以 `chat_template_kwargs: { enable_thinking: false }`
直接放在 `create()` 参数顶层即可。

全部例子已在该 Qwen3 服务上端到端验证通过（含 tool calling、强制
tool_choice、embedding 语义检索、多 agent 嵌套循环与并发 fan-out；
06 的 web_search 走 Bing 结果页解析，需要能访问 bing.com 的网络；
15 的 align.py 需要本机有 python3；16 的第三幕需要已安装的
@modelcontextprotocol/sdk，依赖里已带）。

> 实测坑备忘：① openai SDK v6 的 embeddings 默认发 `encoding_format:
> base64` 并自行解码，Xinference 不支持 base64、照样返回 float 数组，
> SDK 解出全零向量 → cosine 全 NaN、检索静默失效——必须显式传
> `encoding_format: 'float'`（03/12 已修）；② 本服务 qwen3 的上下文
> 窗口实测 40960 tokens，超限返回 HTTP 500 无 body（13 例实测）；
> ③ js-tiktoken 的 o200k_base 词表 ≠ Qwen3 词表，中文实测系统性
> 偏低约 5-6%（14 例）——作为切点估算够用，但必须与每轮 usage 对账；
> ④ skill 指令里不写"本技能无配套脚本"，模型会幻觉出一个脚本路径
> 去执行，失败后写空壳产物（15 例实测）——skill 的指令边界要显式
> 声明"有什么、没有什么"；⑤ MCP stdio 的 stdout 是协议专用通道，
> server 日志混进去一行，client 就 JSON.parse 失败——日志必须走
> stderr（16 例 server.ts 的铁律）。

## 例子与问题对照

| 目录 | 对照的 Mastra 模板 | 回答的问题 |
|---|---|---|
| [01-agent-loop](01-agent-loop/index.ts) | weather-agent / starter-agent | agent loop 的本质：一个 while 循环 + 一个 messages 数组 |
| [02-sessions](02-sessions/index.ts) | docs-chatbot 等 chat 模板 | ① 会话消息如何区分管理：`resourceId`（用户）× `threadId`（会话）→ messages[]，加持久化与上下文裁剪 |
| [03-memory](03-memory/index.ts) | company-knowledge / Mastra Memory | ② 记忆分层：working / episodic / semantic；读 = 每次 LLM 调用前注入，写 = 每轮结束后提炼 |
| [04-hitl](04-hitl/index.ts) | customer-refund-agent | ③a human in the loop：工具执行点 = 暂停点，审批通过则继续，拒绝则把原因喂回模型 |
| [05-harness](05-harness/index.ts) | deep-search / agent-harness | ③b harness：套在 loop 外面的预算、终止条件、结构化产物验收层 |
| [06-full-agent](06-full-agent/index.ts) | Claude Code / Trae 的骨架 | ④ mini Claude Code：同一循环 + 通用工具集（文件/命令/网页搜索）+ ContextManager 自动压缩 |
| [07-multi-agent](07-multi-agent/index.ts) | Claude Code 的 Task 工具 / LangGraph Supervisor | ⑤ multi-agent：把「跑一个 agent loop」注册成工具——orchestrator-worker、上下文隔离、人设分工 |
| [08-multi-agent](08-multi-agent/index.ts) | deep-research 并行检索 / LangGraph map-reduce | ⑥ multi-agent 并行：fan-out/fan-in——拆题 → Promise.all 并发 → 汇总；并行在 harness 不在 LLM，前提是子任务无数据依赖 |
| [09-memory](09-memory/index.ts) | ~/.trae-cn/memory（Trae 内置记忆体系） | ⑦ 文件式分层记忆：不落库——日期目录 + 每轮一行 session jsonl（intent/actions/outcome/learned）+ topics.md 选择性索引；读取 = 最近两天 topics 先粗后细钻取注入 |
| [10-streaming](10-streaming/index.ts) | Trae / Claude Code 的打字机、SSE 协议 | ⑧ 流式输出：感知延迟 vs 总算力；流式 tool call 的分片按 index 累积、攒齐才执行；指数退避 + include_usage 能力探测 |
| [11-evals](11-evals/index.ts) | promptfoo / OpenAI Evals / CI 回归门 | ⑨ 评测：黄金集 + 两路判分（轨迹规则 + LLM-as-judge 结构化输出）+ span 记账——agent 的"单元测试" |
| [12-rag](12-rag/index.ts) | company-knowledge 模板 / 一切问文档的机器人 | ⑩ RAG：切块 → embed 索引 → 混合检索（向量语义 + 关键词字面互补）→ 带引用回答 → 引用编号校验（幻觉检测雏形） |
| [13-context-window](13-context-window/index.ts) | Trae / Claude Code 的会话压缩切换 | ⑪ 上下文窗口：模型无状态、每轮全量重发（真实 usage 验证）；塞满窗口的两种表现（400 报错 vs 静默掐头）；压缩切换 = rolling summary 的产品化 |
| [14-memory](14-memory/index.ts) | Claude Code auto-compact / Mastra Memory 裁剪处理器 | ⑫ 生产级压缩时机：预算公式（窗口×比例 − 输出 − 压缩预留）→ 切点（token 装到线、回退轮次边界，绝不切开 tool 配对）→ 水位线（持久化、只进不退）；三时机口诀"提问只存 / 答前算压发 / 答后只存"；大多数轮零压缩；token 估算三级火箭（字符启发式 → js-tiktoken 真分词器 → usage 对账校准） |
| [15-skills](15-skills/index.ts) | Claude Code / Trae 的 Skill 系统 | ⑬ Agent Skills：知识型能力打包成文件夹（SKILL.md + 附属脚本），渐进式披露三层——目录（name+description，几十 token）常驻 → 命中才 load_skill 加载全文 → 正文引用的脚本再取用；对照实验：裸模型手搓中英混排表格 vs 加载 skill 后调脚本精确对齐；skill 代码三种执行形态——预置脚本直跑（align.py）/ 内嵌代码经 write_file 中转落盘再跑（stats.mjs，模型只是文本中继，执行永远在工具层）/ 纯指令直接生成（svg）；本质是上下文经济学不是 function calling |
| [16-mcp](16-mcp/index.ts) | Trae 的 lark 插件 / Claude Desktop MCP 生态 | ⑭ MCP：工具从进程内函数变跨进程服务——JSON-RPC 2.0 over stdio（initialize 握手 → tools/list 发现 → tools/call 执行），inputSchema 与 OpenAI parameters 同构、适配层薄到字段改名；三幕剧：手写 client↔手写 server（打印每条报文）+ SDK client↔裸 server + 手写 client↔SDK server 双向互通；agent loop 零修改 |

## 三个问题的答案速览

### 1. 会话管理

每条请求带 `(resourceId, threadId)`，服务端维护两者的映射到 messages 数组。
持久化就是这个映射的存取（内存 / 文件 / DB）。上下文裁剪（trim）防止
messages 无限膨胀。→ 看 02 的 `SessionManager`（约 60 行，就是 Mastra
Memory + Storage 的骨架）。

### 2. 分层记忆

- **Working memory**：永远在上下文的小档案，模型可用工具主动更新
- **Episodic**：会话内原始历史，按最近 N 条裁剪进上下文
- **Semantic**：提炼出的持久事实，检索 top-k 注入

**读** = 每次 LLM 调用前组装 system prompt 时注入；**写** = 每轮对话
结束后跑一次提炼调用。→ 看 03 的 `SemanticMemory.extractFromTurn`（写）
和 `retrieve` + `chat()` 开头（读）。

### 3. Agent loop / HITL / Harness

- **Loop**：调模型 → 有 tool call 就执行并喂回 → 没有就结束（01）
- **HITL**：把工具执行改成可暂停的 async，敏感工具先过审批；跨进程
  形态 = 把 messages 序列化存库、断点恢复（04）
- **Harness**：loop 外面加步数预算、强制结构化产出（`tool_choice` 强制
  调用 submit 工具）、过程观测（05）

## 下一步

1. 跑通全部 16 个例子，改参数观察行为（比如把 06 的 `MAX_CONTEXT_TOKENS` 调成
   6000 看压缩是否还会触发、`KEEP_RECENT` 调成 2 看模型丢细节）
2. 对照读 Mastra 源码：
   - `packages/core/src/agent` — agent loop 的生产版
   - `packages/core/src/memory` — 三层记忆的生产版
   - `templates/template-customer-refund-agent` — HITL 工作流
3. 进阶：
   - 把 05 的 mock search 换成真实搜索 API，就是自己的 deep-search
   - 给 06 的敏感工具（write_file/run_command）接上 04 的审批门，
     就是一个带 HITL 的 mini 编程 agent
   - 给 07 的工人换上 06 的通用工具集（或给 delegate 接上 04 的审批门），
     就是一个小型编程 agent 团队（Claude Code 的 Task 工具即此形态）
   - 把 08 的调研员换成带 web_search 的工人（06 的工具），就是并行版
     deep-research；再套 05 的步数预算和结构化提交就是生产形态
   - 给 15 再写一个 skill（比如 markdown 转飞书文档的规范），体会
     description 写法对命中率的影响——这是 skill 工程的核心手艺
   - 把 16 的手写 server 换成官方 filesystem server
     （`npx -y @modelcontextprotocol/server-filesystem`），agent loop
     一行不改就能用上全套文件工具——这就是 MCP 生态的即插即用
