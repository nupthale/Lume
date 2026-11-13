# lume

类 Claude Code / Trae 的 agent 客户端工具。架构路线：**daemon（agent harness 核心 + CLI）先行，GUI 通过长驻子进程 + stream-json 事件流协议驱动 daemon**。

## Monorepo 布局

| 包 | 说明 |
|---|---|
| `packages/protocol` | 共享事件协议（zod schema，NDJSON over stdio） |
| `apps/daemon` | agent 核心：loop、harness（think→review→act→verify）、CLI |
| `apps/web` | Web 前端（占位，后续阶段） |
| `apps/client` | Electron 壳（占位，后续阶段） |

## 快速开始

```bash
pnpm install
pnpm build
pnpm test
```

### 终端 REPL 模式

```bash
LUME_API_BASE_URL=http://your-openai-compatible-endpoint/v1 \
LUME_MODEL=qwen3 \
pnpm --filter @lume/daemon dev
```

命令：`/help`、`/interrupt`（中止当前轮）、`/exit`。

### stream-json 模式（GUI 驱动入口）

```bash
lume --mode stream
```

stdout 输出 NDJSON 事件，stdin 接收 NDJSON 消息。日志只走 stderr。

### 配置（环境变量）

| 变量 | 说明 | 默认 |
|---|---|---|
| `LUME_API_BASE_URL` | OpenAI-compatible base URL | 必填（真实 provider） |
| `LUME_API_KEY` | API key | `EMPTY` |
| `LUME_MODEL` | 模型名 | 必填 |
| `LUME_PROVIDER` | `openai` 或 `fake`（冒烟测试） | `openai` |
| `LUME_CWD` | 工具工作目录 | 进程 cwd |
| `LUME_MAX_TOOL_LOOPS` | 每轮最大工具循环数（护栏） | `25` |
| `LUME_AUTO_APPROVE_TOOLS` | 免人工确认的工具（逗号分隔） | 空 |
| `LUME_REQUEST_TIMEOUT_MS` / `LUME_TOOL_TIMEOUT_MS` | 超时 | `120000` / `60000` |

## 架构

```
┌────────────────────────┐   NDJSON 事件流    ┌──────────────────────┐
│ Electron 壳 / Web 前端  │ ◀═══════════════▶ │ daemon 子进程          │
│ (apps/client / web)    │   stdout / stdin  │  ├ cli/stream.ts 皮肤  │
└────────────────────────┘                   │  ├ cli/repl.ts 皮肤    │
                                             │  ├ core/agent.ts 轮次循环│
                                             │  ├ core/harness.ts 微循环│
                                             │  │  think→review→act→verify│
                                             │  ├ providers/ (LLM)   │
                                             │  └ tools/ (bash/r/w/e) │
                                             └──────────────────────┘
```

核心纪律：core 只通过 `Frontend.emit()` 输出、只通过 `await Frontend.requestPermission()` 与人交互；权限确认以挂起/恢复（id → resolve）实现；进程退出只由皮肤层驱动。

## 事件流协议（v1）

Outbound（daemon → 消费方），一轮含工具调用的完整生命周期：

```
ready → turn_started
  → assistant_message_started → assistant_delta* → assistant_message_completed
  → thought?
  → tool_call_requested            # think
  → review_started → review_completed {checks, approved, requires_permission}
  → permission_request?            # 挂起，等待 permission_response
  → tool_started → tool_completed | tool_failed   # act
  → verification_started → verification_completed {passed, note}   # verify
  → (微循环 ×N)
  → turn_completed | turn_failed
```

Inbound（消费方 → daemon）：`user_message`（忙时自动排队）、`permission_response {id, approve}`、`interrupt {turn_id?}`、`shutdown`。

## 工具与权限策略

| 工具 | 风险级 | 默认策略 |
|---|---|---|
| `read_file` | read | 自动放行 |
| `write_file` / `edit_file` | write | 需人工确认 |
| `bash` | execute | 需人工确认 + 危险命令静态拦截 |

文件工具限制在工作目录内（路径边界 review 检查）；bash 有超时、输出截断和危险模式拦截（sudo、rm -rf /、管道执行远端脚本等）。

## Roadmap

- [x] daemon：loop + harness 微循环 + 事件流全生命周期 + 双模式 CLI
- [ ] 会话持久化与 resume（append-only JSONL）
- [ ] 上下文管理（rolling summary + 水位线）
- [ ] `apps/web` Web 前端
- [ ] `apps/client` Electron 壳
