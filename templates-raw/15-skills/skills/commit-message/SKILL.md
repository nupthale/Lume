---
name: commit-message
description: 按 Conventional Commits 规范生成 git 提交信息。当用户要求"写 commit message / 提交信息 / 帮我 commit"时使用。
---

# Conventional Commits（中文项目版）

## 格式

```
<type>(<scope>): <subject>

<body>
```

## type 取值

feat 新功能 | fix 缺陷修复 | docs 文档 | refactor 重构
test 测试 | chore 杂务 | perf 性能 | ci 构建流程

## 规则

1. subject 用中文，≤ 50 字，祈使语气，结尾不加句号
2. scope 用小写英文模块名（如 `memory`、`api`），没有明确模块时可省略
3. body 只说明"为什么"，不罗列"改了什么"（diff 自己会说话），每行 ≤ 72 字符
4. 破坏性变更：type 后加 `!`，body 里必须有 `BREAKING CHANGE:` 段落
5. 关闭 issue 写在 body 末行：`Closes #123`
