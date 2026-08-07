---
name: sn2s-novel-to-screenplay
description: 直接在 Storyflow 中将本地 TXT、Markdown、DOCX 或 PDF 小说转换为可续作的分集竖屏短剧剧本，涵盖确定性分集、故事元数据、人物连续性、逐集创作、校验、修订检查点、回滚与最终合并。用户要求把小说转换成剧本、短剧剧本、分集剧本、改写指定集或建立完整剧本项目时，都使用此 Skill，即使未提及 SN2S。
metadata: { displayName: 小说转剧本 }
---

# 小说转剧本

在当前 Storyflow Agent 内完整执行 SN2S 方法。使用当前模型分析小说和创作剧本，
内置本地辅助脚本只负责确定性文件操作。

## 语言与命名

- 遵循系统提示词中的用户选定语言：回答、状态报告、故事元数据、连续性内容和
  新建的用户可见文件/文件夹名称都使用该语言。
- 运行 `prepare` 时，把系统提示词给出的语言代码传给 `--language`；如果没有明确
  代码，使用 `zh-Hans`。不要根据路径、代码或原文片段猜测语言。
- `project.json`、`scripts/screenplay_project.py`、`project.json` 内的字段名以及脚本
  命令是运行时契约，保持既有英文格式。创建项目后，始终读取 `project.json` 的
  `prepared_source`、`metadata_path`、`continuity_path`、`full_screenplay`、
  `source_path` 和 `script_path`，不要自行拼接英文路径。

## 加载方法

按需读取：

- 准备或恢复项目前，读取 `references/workflow.md`。
- 创作或修订剧本前，读取 `references/adaptation-policy.md`。
- 创作、校验或合并前，读取 `references/screenplay-format.md`。

所有内置路径都相对于本 Skill 目录解析。

## 使用本地辅助脚本

辅助脚本使用 Python 标准库：

```bash
python3 scripts/screenplay_project.py --help
```

使用任意可用的 Python 3 解释器。辅助脚本负责规范化、确定性分集、格式检查、
本地版本快照、回滚与合并；Agent 负责理解故事和创作剧本。

## 明确请求

只需要：

1. 小说源文件路径。
2. 输出目录；未指定时，默认使用源文件旁边、符合当前语言的项目目录名（例如中文
   使用 `<source-stem>-剧本`，英文使用 `<source-stem>-screenplay`）。
3. 转换模式；用户未选择时默认使用 `compact`。可选值为 `compact`、`aligned`
   或 `rich`。

直接采用上述默认值。

保持源文件不变；处理长篇内容时始终通过文件读取。

## 准备项目

对于 TXT、Markdown 或 DOCX：

```bash
python3 scripts/screenplay_project.py prepare \
  /absolute/path/to/novel.txt \
  /absolute/path/to/novel-screenplay \
  --mode compact \
  --language <selected-language-code>
```

对于 PDF，使用 Storyflow 常规文档读取能力把文本提取到临时 UTF-8 `.txt`
文件，再把该文件交给 `prepare`。

辅助脚本拒绝覆盖非空输出目录，必须保留这一保护。读取返回的 `project.json`，
报告识别出的分集方式、集数、索引和标题。

如果用户要求检查或确认分集，就在这里停止；否则继续完成完整转换。

## 建立全局故事状态

根据 `project.json` 的 `metadata_path` 填写故事元数据：

- 标题；
- 简洁的全篇故事梗概；
- 题材与目标受众；
- 世界规则、时代和反复出现的地点；
- 主要人物的身份、目标、冲突、说话方式和关系。

在 `project.json` 的 `continuity_path` 指向的文件中记录已确认事实、人物状态、关系变化、未解决伏笔，
以及每个已完成分集的简要摘要。

如果源文件过大，无法一次放入上下文，就按顺序处理准备好的分集文件，并把事实
合并到这两个文件中。以原文为事实来源；不确定的事实明确标注为待确认。

## 创作分集

对 `project.json` 中的每个条目：

1. 读取它的 `source_path`、`metadata_path` 和 `continuity_path` 指向的文件。
2. 按 `references/screenplay-format.md` 创作对应的 `script_path`。
3. 应用 `references/adaptation-policy.md` 中选定的模式。
4. 保留主要因果、人物关系、关键反转、必要对白，以及姓名、地点、机构和重要道具。
5. 用本集结果和遗留伏笔更新 `continuity_path` 指向的文件。
6. 校验本集：

```bash
python3 scripts/screenplay_project.py validate PROJECT_DIR EPISODE_INDEX
```

继续前修复所有校验错误。长度警告只作为审查信号：因果完整和必要上下文优先于
精确比例。

默认按顺序创作，因为连续性比单纯并行更重要。长项目只有在全局元数据建立后，
才可采用小批量并行；每个 worker 都必须获得相同元数据、准确的本集原文和相邻集
摘要，随后再执行跨集连续性审查。

只有本地校验状态为 `valid`，且通过 `references/screenplay-format.md` 中的
语义审查后，才能声称本集完成。

## 合并完整剧本

所有分集都有效后：

```bash
python3 scripts/screenplay_project.py merge PROJECT_DIR
```

辅助脚本会再次校验每一集并写入 `project.json` 的 `full_screenplay` 指向的文件。它拒绝合并不完整或
无效的项目，也拒绝覆盖已有合并文件。

报告完成前，确认合并文件存在且非空。

## 修订与回滚

修改已有分集前，先创建本地检查点：

```bash
python3 scripts/screenplay_project.py checkpoint PROJECT_DIR EPISODE_INDEX
```

读取当前分集，展示准确的拟议 diff，获得确认后再写入；编辑后重新校验。

恢复旧版本时：

1. 展示准确的版本路径和目标分集。
2. 单独获得确认。
3. 运行：

```bash
python3 scripts/screenplay_project.py restore \
  PROJECT_DIR EPISODE_INDEX VERSION_PATH --yes
```

`--yes` 只表示已经完成确认，不能替代对话确认步骤。辅助脚本会在恢复前为当前
文件创建检查点，并校验恢复后的分集。

## 续作与恢复

使用 `project.json` 作为续作索引：

- `pending`：尚未创作；
- `invalid`：已经创作，但需要修复；
- `valid`：格式有效，可以合并。

某一集失败时，保留其他成功分集，只继续处理 `pending` 或 `invalid` 分集。

如果故事事实冲突，暂停受影响分集，引用相互冲突的原文；解决冲突并更新
`continuity_path` 指向的文件后，只重新校验受影响的剧本。

## 完成报告

Return:

```text
小说转剧本
- 项目目录：<项目绝对路径>
- 模式：<compact|aligned|rich>
- 分集：<count>
- 已通过校验：<count>/<count>
- 完整剧本：<project.json 的 full_screenplay 绝对路径>
- 待处理：<仅在仍有未完成事项时填写>
```

先给出输出路径，正文保留在结果文件中。
