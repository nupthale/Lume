# 20 — OpenViking 调研笔记（Context Database for AI Agents）

> 上游仓库: https://github.com/volcengine/OpenViking （字节/火山引擎开源，主项目 AGPLv3）
> 本目录只有调研笔记，没有可运行示例。
> 结论先行：**它的成熟部分是一套层级化知识检索基建，灵魂是"消费方是 agent"——本质是给 agent loop 用的层级检索引擎。**

---

## 一、它是什么

OpenViking 是一个专门给 AI Agent 用的开源 **Context Database（上下文数据库）**，
目标是替代碎片化的上下文管理（记忆在代码里、知识在向量库、技能散落各处），
用**文件系统范式**统一组织 Agent 需要的 memories / resources / skills。

四个核心卖点：

| 卖点 | 解决什么 | 实质 |
|---|---|---|
| 文件系统管理范式 | 上下文碎片化 | 所有上下文装进 `viking://` URI 命名空间的虚拟文件系统，用 `ls/tree/find/grep` 管理；另有 Go 写的 AGFS 组件可真正挂载 |
| L0/L1/L2 分层加载 | Token 消耗 | 每个目录/文件自动生成三层视图，按需下钻 |
| 目录递归检索 | 平铺 top-k 检索效果差 | 意图分析 → 向量初筛定位高分目录 → 目录内二次检索 → 递归下钻，把 Agentic RAG 内化成存储引擎原语 |
| 可视化检索轨迹 | RAG 黑盒难调试 | 每次检索的目录浏览/文件定位轨迹全保留 |

外加一个"会话自动沉淀"：会话结束后触发记忆提取，异步更新 User/Agent 记忆目录。

### L0/L1/L2 三层结构

```
viking://resources/my_project/
├── .abstract               # L0: 一句话摘要（~100 tokens）— 快速判断相关性
├── .overview               # L1: 核心信息（~2k tokens）— 规划阶段决策用
├── docs/
│   ├── .abstract           # 每个目录都有对应的 L0/L1 层
│   ├── .overview
│   ├── api/
│   │   ├── .abstract
│   │   ├── .overview
│   │   ├── auth.md         # L2: 完整原文 — 确实需要时才加载
│   │   └── endpoints.md
│   └── ...
└── src/
    └── ...
```

## 二、怎么用（本地模式最短路径）

**心智模型**：OpenViking = 一个服务 + 一个虚拟文件系统 + 一把工具。
它**不替代你的 agent**（内置的 VikingBot 只是玩具 agent），它给你的 agent
提供一个"可检索的资料库"——`ov` CLI 就是设计给 agent 执行的工具面。

```
你的资料 ──add-resource──▶ OpenViking 服务 ──▶ workspace（viking:// 虚拟目录树）
                          （后台语义处理：          │
                           VLM 生成 L0/L1 摘要，    │ find（语义检索）
                           embedding 建索引）       │ read（读 L2 原文）
                                                  ▼
                                        你的 Agent 调这些命令拿上下文
```

**前置**：Node.js LTS（装 CLI 用）+ [uv](https://docs.astral.sh/uv/) + Python 3.13
+ 两个模型的凭据（一个 embedding 模型 + 一个支持 tool-call 的对话模型，即配置里的 VLM）。

```bash
# 1. 安装（服务 + 内置 VikingBot）
uv tool install --python 3.13 "openviking[bot]" --upgrade

# 2. 交互式配置向导：选 local access，填 embedding 和 VLM 的模型名/端点/key
#    （自动生成 ~/.openviking/ov.conf，比 README 里手写 JSON 省事）
openviking-server init

# 3. 自检，报错按提示改
openviking-server doctor

# 4. 起服务（这个终端保持运行）
openviking-server --with-bot
# 另开终端验证：
curl -f http://127.0.0.1:1933/health

# 5. 装 CLI 并连接
npm install -g @openviking/cli
ov config        # 向导里选 Custom → http://127.0.0.1:1933，key 留空
ov health

# 6. 灌数据（本地文件/目录/GitHub 仓库都行）
ov add-resource ./你的文档 --to viking://resources/my-demo --wait
ov tree viking://resources/my-demo     # 看导入结果

# 7. 检索 + 问答
ov find "你的问题" --uri viking://resources/my-demo   # 语义检索，返回 URI 列表
ov read "<上面返回的某个-uri>"                        # 读原文（L2 层）
ov chat -m "只用 viking://resources/my-demo 下的资料回答：……，结论要引用 viking:// URI"
```

### 三个最容易卡住的点

1. **`add-resource` 不是立刻可检索**：后台要做语义处理（VLM 给每个目录生成
   `.abstract`/`.overview`，embedding 建索引）。大仓库不 `--wait` 的话用
   `ov task status <task_id>` 查进度，没处理完 `find` 就是空的。
2. **两条部署路线别混**：火山云服务（控制台开通拿 API key，本地只装 CLI，
   免本地模型）vs 本地服务（自己准备 embedding + VLM 两个模型）。
   本地路线 embedding 支持 openai 兼容自定义端点，理论上 Xinference 的
   Qwen3-Embedding-8B 能用 `provider: "openai"` + 自定义 `api_base` 接入；
   但 VikingBot 要求 VLM 支持 tool-call。
3. **接入自己的 agent 的方式**：让 agent 执行 `ov find` / `ov read`
   （云服务版文档的示例就是把这段命令直接作为任务发给能跑终端的 agent），
   或者走 HTTP API / Python SDK。

> 注：README（老路径：pip install + 手写 ov.conf + openviking-server）和
> docs/en/getting-started/02-quickstart.md（2026-10 重写的新路径：uv tool
> install + init 向导 + npm CLI）两套文档并存，以上是新路径。

## 三、定位分析：知识库检索的身体，agent 的灵魂

### 区别在消费方是谁

- **传统知识库检索**（RAGFlow / Dify 知识库那类）：人提问 → 一次检索 → 生成答案。
  检索是黑盒管道，人只看结果。
- **OpenViking**：agent 拿到任务 → 自己执行多步检索（`find` 定位 → 读 L1
  overview 决定要不要钻 → `read` L2 原文 → 引用 URI）。检索过程本身是
  agent 的工具调用序列。

四个卖点里三个半都是知识检索基建；真正 "agent 专属" 的设计只有
`viking://` 文件系统范式那一条——它把 Claude Code 导航代码库的那套工具习惯
（grep → read file → 顺藤摸瓜）泛化到了任意资料上。
而叙事里的"记忆自迭代"（memories/、会话沉淀）反而是薄的部分。

### 对照本仓库 03-memory 的记忆分层

| 记忆层 | OpenViking 对应 |
|---|---|
| L1 用户档案 | `memories/` user 部分 |
| L2 情景 | 会话压缩 + session 管理 |
| L3 语义 | memories + resources 全走分层检索 |
| L4 程序性 | `skills/` 目录 |

### 与 mem0 的区别（一句话）

mem0 是"平铺的记忆 CRUD API"（add/search 两个调用，见 19-mem0 demo），
OpenViking 是"带分层懒加载和递归检索的层级上下文库"——思路更接近
Anthropic memory tool 的文件式记忆 + Claude Code 的目录式上下文管理，
但做成了独立的数据库服务。

## 四、选型建议

- 要**用户记忆/个性化** → mem0（或 Mastra/Letta），OpenViking 是绕远路
- 要 **agent 可自主导航的资料库**（代码库、文档库、多跳问题）→ OpenViking 的
  定位才成立，普通向量库 top-k 撑不住"先看结构再决定读哪"的场景
- 要**给人用的知识库问答** → 用不上它，RAGFlow/Dify 这类成品更省事

技术要求：VLM（目录理解/摘要生成，需 tool-call 支持）+ embedding 双模型；
Go 1.22+（构建 AGFS）；主项目 AGPLv3，CLI/examples 为 Apache 2.0。
