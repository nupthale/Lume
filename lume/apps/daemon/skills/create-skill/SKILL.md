---
name: create-skill
description: 为 lume 创建一个新的 skill（把可复用的任务流程沉淀成 SKILL.md）
---

# 创建 lume skill

当用户想把某个可复用的任务流程（部署步骤、报告生成、脚手架搭建等）沉淀为 skill 时，按以下规范操作。

## 目录结构

skill 是一个目录，入口必须是 `SKILL.md`：

```
<name>/
├── SKILL.md          # 必需：frontmatter + 指令正文
├── scripts/          # 可选：可执行脚本
├── references/       # 可选：参考资料（额外文档）
└── assets/           # 可选：模板、静态资源
```

## SKILL.md 规范

1. frontmatter 必须以 `---` 开始和结束，包含两个必填字段：

```markdown
---
name: <skill名，需与目录名一致>
description: 一句话说明这个 skill 做什么、什么时候该用它
---
```

2. `description` 是模型决定是否使用该 skill 的唯一依据，务必写清楚**触发场景**而不只是功能名。
3. 目录名即 skill 名，只允许字母、数字、`.`、`_`、`-`，且不以 `.` 开头。
4. 正文是给模型的操作指令，写清楚步骤、边界条件、失败时怎么办。
5. 嵌套资源不要塞进正文，在正文里指示"运行 scripts/xxx.sh"或"阅读 references/xxx.md"，模型会用 bash / read_file 工具按需访问。

## 放置位置

- 项目级：`<项目根>/.lume/skills/<name>/`（团队共享，优先级最高）
- 用户级：`~/.lume/skills/<name>/`（个人跨项目复用）

同名 skill 项目级覆盖用户级。创建完成后下一个 turn 自动生效，无需重启。

## 创建步骤

1. 与用户确认 skill 名、放置层级（项目级还是用户级）
2. 创建目录和 SKILL.md（含 frontmatter 和正文）
3. 如有脚本/模板，创建 scripts/ 或 assets/ 并写入
4. 向用户展示最终结构，提示下个 turn 生效
