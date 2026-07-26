---
name: skill-creator
description: "用于通过持续对话创建、总结或改进 Storyflow Skills；当用户要新增 Skill、把一段对话沉淀为 Skill、优化现有 SKILL.md，或判断一套经验是否值得固化时使用。"
metadata:
  displayName: Skill 创建器
---

# Skill 创建器

## 核心原则

Skill 保存可复用、非显而易见的方法，不保存整段对话。默认假设 Agent 已经具备通用能力，只固化领域知识、稳定流程、工具契约和反复出现的判断标准。

先确认真实用法，再创建文件。没有具体使用示例、触发场景和成功标准时，继续对话，不用空泛模板填补信息。

## 对话流程

1. 检查目标作用域中已有 Skills，避免创建同义或职责重叠的 Skill。
2. 从用户描述和当前对话中提取：
   - 这个 Skill 解决什么重复问题。
   - 用户会怎样表达需求，哪些话应该触发它。
   - 必要输入、期望输出、成功标准和不可突破的边界。
   - 哪些内容是稳定知识，哪些只是本次任务的临时约束。
3. 只追问会显著改变 Skill 设计的问题。每轮优先问一个最关键问题，用户已经说清楚的内容不要重复确认。
4. 每次回复末尾维护一份简短草案：

```markdown
**当前 Skill 草案**
- 名称：
- 触发场景：
- 核心流程：
- 输入/输出：
- 边界：
- 可选资源：
- 尚待确认：
```

5. 草案完整后，先展示建议的目录与 `SKILL.md` 摘要。只有用户明确表示创建、确认或保存后，才写入文件。

## 内容设计

- 名称使用小写字母、数字和连字符，最长 64 个字符；目录名与 frontmatter `name` 完全一致。
- `description` 同时说明能力和触发场景，因为它是 Skill 的主要发现入口。
- 正文使用直接、可执行的指令，优先表达流程、判断标准、输入输出和失败边界。
- 根据任务脆弱度选择自由度：
  - 多种做法都成立时，写原则和启发式。
  - 有稳定模式但允许变化时，写伪代码、参数或结构化步骤。
  - 容易出错且顺序严格时，提供最小确定性脚本。
- 只在确有需要时增加：
  - `references/`：稳定的详细资料、协议或领域模型。
  - `scripts/`：反复重写或必须确定执行的逻辑。
  - `assets/`：生成结果需要复用的模板或素材。
- 详细内容只保留一份。核心流程放在 `SKILL.md`，其余放到一级引用文件并从 `SKILL.md` 直接链接。
- `SKILL.md` 保持在 500 行以内；接近上限时按需拆分。

## Storyflow 契约

创建位置由当前产品入口提供的 `<edit_request>` 决定。调用创建与验证 Tool 时，必须原样传递其中的 `<target_workspace_id>`：

- 项目 Skill：`<project>/.pi/skills/<slug>/`
- 全局 Skill：`~/.craft-agent/skills/<slug>/`

不得改变用户选择的作用域，不得写入 `~/.agents`、`~/.codex` 或其他隐式资源目录。

`SKILL.md` 至少包含：

```markdown
---
name: example-skill
description: "说明能力以及何时使用。"
metadata:
  displayName: 示例 Skill
---

# 示例 Skill

执行该 Skill 所需的最小指令。
```

仅在真实需要时添加 `requiredSources`、`globs`、`alwaysAllow` 或 `icon`。不要创建 `agents/openai.yaml`、README、安装指南、变更日志或其他过程文档；发布到 Skills Market 时才按发布契约补充包元数据。

## 写入与验证

1. 写入前再次确认 slug、作用域、触发描述和是否与已有 Skill 冲突。
2. 已存在同名 Skill 时禁止静默覆盖；让用户选择更新现有 Skill 或使用新 slug。
3. 用户确认后，把完整 `SKILL.md` 和 `targetWorkspaceId` 交给 `skill_create`；该 Tool 会校验 Storyflow workspace、创建目录并拒绝覆盖已有 Skill。不要用通用文件工具或 shell 代替它。
4. 使用同一个 `targetWorkspaceId` 调用 `skill_validate` 验证生成结果；验证失败时说明问题，不要声称已经完成。
5. 完成后报告 Skill 名称、作用域、实际路径、验证结果和一个可直接尝试的调用示例。

当前创建动作只生成最小 `SKILL.md`。只有真实使用证明还需要确定性脚本、参考资料或素材时，再通过产品后续的 Skill 编辑能力增补；不要为了结构完整预先生成空目录。

## 迭代

真实使用反馈优先于预想。用户发现触发不准、步骤含糊或输出不稳定时，基于失败证据修改 Skill；不要为尚未出现的问题提前增加分支、关键词表或抽象层。
