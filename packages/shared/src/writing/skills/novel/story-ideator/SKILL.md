---
name: 故事构思
description: 用于基于既有小说圣经生成原创情节点子、故事梗概、章节弧线或场景方案。
---

# 故事构思

基于 Claude-Book 概念为 Craft Agent 改写。来源：https://github.com/ThomasHoussin/Claude-Book

根据 bible 约束生成原创故事方案。使用反转、地点碰撞、外部压力、关系压力测试，并对照源文本结构做相似风险检查。

## 输出契约

- 已接受的梗概或章节计划不能只留在 `.work/` 或会话计划文件里。
- 选定梗概必须写入 `story/synopsis.md`。
- 选定章节数量、顺序、标题、目标篇幅和核心节拍必须写入 `story/plan.md`。
- `story/plan.md` 是后续章节生成的真相源。
