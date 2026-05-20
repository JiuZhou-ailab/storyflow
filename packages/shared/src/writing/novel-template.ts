// input: Workspace root path, optional writing metadata, and selected Method Pack
// output: Idempotent writing project scaffold for built-in Method Packs
// pos: Scaffold creator for project-level creative writing environments

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getClaudeBookNotice } from "./claude-book-notice.ts";
import {
  CLAUDE_BOOK_METHOD_PACK,
  getBuiltInMethodPack,
  type MethodPack,
  type MethodPackId,
} from "./method-packs/index.ts";
import { getBundledNovelSkillFiles } from "./novel-skills.ts";
import type { WritingProjectManifest } from "./types.ts";

export interface CreateNovelProjectScaffoldOptions {
  title?: string;
  language?: string;
  methodPackId?: MethodPackId;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function writeFileIfMissing(path: string, content: string): void {
  ensureDir(dirname(path));
  if (!existsSync(path)) {
    writeFileSync(path, content);
  }
}

function hasManuscriptFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return readdirSync(path, { withFileTypes: true }).some((entry) =>
      entry.isFile()
      && !entry.name.startsWith(".")
      && entry.name.toLowerCase().endsWith(".md")
    );
  } catch {
    return false;
  }
}

function resolveMethodPack(methodPackId?: MethodPackId): MethodPack {
  const pack = getBuiltInMethodPack(methodPackId ?? CLAUDE_BOOK_METHOD_PACK.id);
  if (!pack) {
    throw new Error(`Unknown method pack: ${methodPackId}`);
  }
  return pack;
}

function createManifest(
  options: CreateNovelProjectScaffoldOptions,
  pack: MethodPack
): WritingProjectManifest {
  return {
    schemaVersion: 1,
    type: pack.projectType,
    title: options.title,
    language: options.language,
    profile: pack.projectType,
    methodPack: {
      id: pack.id,
      version: pack.version,
    },
    storageProfile: pack.storageProfile,
  };
}

function createPackLock(pack: MethodPack): string {
  return `${JSON.stringify({
    methodPack: {
      id: pack.id,
      version: pack.version,
    },
    source: pack.source,
    installedSkills: pack.requiredSkills,
    installedPaths: pack.requiredPaths.map((path) => path.path),
  }, null, 2)}\n`;
}

function createChineseRuntimeSummary(pack: MethodPack): string {
  switch (pack.id) {
    case "novel.claude-book":
      return `## Agent 运行画像

- 身份：长篇小说架构与连续性守门员，优先保护正典、章节顺序、状态延续和正文一致性。
- 默认入口 skill：\`${pack.defaultSkill}\`。
- 初始请求：不要从宽泛首轮请求直接起草正文；先确认前提、设定约束、简介、章节计划、视角、语气和连续性假设。

## 文件结构契约

- \`bible/\`：长期正典，包括风格、结构、角色、世界观和不可推翻事实。
- \`story/synopsis.md\`：起草章节前接受的故事方向。
- \`story/plan.md\`：章节数量、顺序、标题、篇幅和 beats 的唯一契约。
- \`story/chapters/\`：已接受正文；工作草稿不要放入这里。
- \`state/current/\`：已接受章节后的当前局面、角色状态和信息边界。
- \`timeline/\`：时间线、历史记录和当前章节 chronology。
- \`.work/\`：临时章节计划、草稿、审校报告和分析碎片。

## Skill 路由

- 缺少前提、简介或章节计划：先用 \`story-ideator\`。
- 需要起草章节：先经过 \`chapter-workflow\`。
- 需要风格、角色或连续性审校：分别使用对应 review skill。
- 已接受章节改变连续性：使用 \`state-updater\` 更新状态。`;
    case "novel.oh-story":
      return `## Agent 运行画像

- 身份：网文连载策划编辑，优先处理题材承诺、平台节奏、情绪回报、对标学习和追读动能。
- 默认入口 skill：\`${pack.defaultSkill}\`。
- 初始请求：不要从宽泛首轮请求直接起草正文；先判断男频、女频、双男主等赛道维度，以及题材承诺、主角设置、情绪引擎、反转节奏、爽点回报和下一产物。

## 文件结构契约

- \`设定/\`：世界观、角色、势力、关系、术语和故事约束。
- \`设定/题材定位.md\`：市场赛道、读者承诺、题材期待、语气和差异化钩子。
- \`大纲/大纲.md\`：已接受结构、弧线、反转、回报和章节计划。
- \`正文/\`：定位与大纲清楚后的已接受正文。
- \`追踪/\`：上下文、伏笔、时间线和连载状态。
- \`拆文库/\`、\`对标/\`：对标拆解和可复用写法观察。
- \`参考资料/\`：可追溯素材。
- \`.work/\`：临时信息收集、草稿、试验和审校报告。

## Skill 路由

- 初始创作请求需要赛道判断或维度补齐：先用 \`story\`。
- 工作区创建或修复：使用 \`story-setup\`。
- 长篇拆文、分析、起草：按需使用 \`story-long-scan\`、\`story-long-analyze\`、\`story-long-write\`。
- 短篇种子、反转、爽点分析或起草：按需使用 \`story-short-scan\`、\`story-short-analyze\`、\`story-short-write\`。
- 草稿需要去 AI 味或质量审校：使用 \`story-deslop\` 或 \`story-review\`。`;
    case "novel.crucible":
      return `## Agent 运行画像

- 身份：Crucible 结构型小说规划者，优先保护主题问题、strand map、forge point 和章节结构。
- 默认入口 skill：\`${pack.defaultSkill}\`。
- 初始请求：先建立核心命题、strand、世界锻造和章节地图，再进入正文。

## 文件结构契约

- \`planning/\`：主题、strand、forge point、角色镜像、世界和代价账本。
- \`outline/\`：总纲与分章结构。
- \`draft/chapters/\`：章节工作稿。
- \`draft/reviews/\`：审校与修改意见。
- \`story-bible.json\`：结构化正典。
- \`style-profile.md\`：风格要求。
- \`.work/\`：临时推演和分析。

## Skill 路由

- 缺少核心命题或结构地图：先用 \`${pack.defaultSkill}\`。
- 正文前先补齐规划文档与大纲。
- 审校意见放入 \`draft/reviews/\`，不要混入已接受正文。`;
    case "novel.creative-writing":
      return `## Agent 运行画像

- 身份：通用创意写作助手，优先管理知识库、风格、角色、世界观、草稿和审校反馈。
- 默认入口 skill：\`${pack.defaultSkill}\`。
- 初始请求：先确认项目目标、体裁、读者预期、风格、角色与世界约束，再进入大纲或正文。

## 文件结构契约

- \`story/chapters/\`：已接受正文。
- \`work/outline/\`：大纲与结构规划。
- \`work/drafts/\`：工作草稿。
- \`work/critique-reports/\`：审校报告。
- \`work/brainstorm/\`：头脑风暴和备选方向。
- \`kb/\`：风格、角色、世界、时间线、正典事实和问题清单。

## Skill 路由

- 需要正文起草：使用 \`prose-writing\`。
- 需要维护知识库或正典：使用 \`kb-management\`。
- 草稿和审校材料保持在 \`work/\` 下，只有接受稿进入 \`story/chapters/\`。`;
    case "short-form.article":
      return `## Agent 运行画像

- 身份：中文短篇/中篇网文（5,000-30,000 字）写作搭档，单工作区只承载一本书。
- 默认中文第一人称口语化叙事；章节标题就是钩子。
- 默认一次只写一章；不要一次生成多章或多篇正文，除非用户明确要求批量生成。
- 初始请求：先把题材定位、主角设置、目标读者、核心钩子、黄金三章、小说密度、事件密度和情绪调动程度写进 简报.md，再补 大纲.md，最后才进入 正文/。

## 文件契约

- \`创作要求.md\`：跨项目长期生效的写作风格、读者偏好、禁区。
- \`简报.md\`：当前作品的题材、卖点、目标读者、核心钩子、黄金三章、小说密度、事件密度、情绪调动程度、篇幅目标。
- \`大纲.md\`：分章节 beat 计划，每章一段。
- \`人物.md\`：角色档案、关系、动机、口头禅、成长曲线。
- \`素材.md\`：地点、行业知识、对标桥段、可复用台词。
- \`正文/\`：唯一成稿目录，可以按卷、篇或阶段建立子目录；章节命名 \`NN-标题.md\`。
- \`自由区/\`：临时大纲实验、被废弃章节版本、试写、审校笔记；可以自由创建文件和文件夹。

## 命名规则

- \`正文/NN-标题.md\`，例如 \`正文/01-未婚夫和闺蜜在我葬礼上接吻.md\`。
- \`自由区/YYYYMMDD-目的.md\`，例如 \`自由区/20260514-反派人设试稿.md\`。

## 版本控制

- 修订直接覆盖同一章节文件，靠 git diff 留痕；不要建立 \`草稿/\` 或 \`定稿/\`。
- 多版本试稿放 \`自由区/\`，不要污染 \`正文/\`。
- 正文/ 可以按卷、篇或阶段建立子目录；自由区/ 可以自由创建文件和文件夹。
- 不要预先生成空章节文件，写到哪一章再创建对应 \`NN-标题.md\`。`;
  }
}

function createShortFormAgentInstructions(pack: MethodPack): string {
  return `# ${pack.displayName}

本项目使用 \`${pack.id}\` Method Pack。一个工作区只承载一本书，目标篇幅 5,000-30,000 字。

${createChineseRuntimeSummary(pack)}

## 工作流硬门禁

- 在 简报.md 与 大纲.md 仍是模板时，不要写入 正文/。
- 在 简报.md 的黄金三章、小说密度、事件密度或情绪调动程度仍缺失时，不要写入 正文/；前三章留存设计不清楚，后续大纲先停。
- 先确认题材定位、主角设置、目标读者、核心钩子、前三章留存目标、小说密度、事件密度、情绪调动程度和篇幅目标，把答案落到 简报.md 与 大纲.md，再进入正文。
- 章节先有大纲对应段落，再写 \`正文/NN-标题.md\`。
- 默认逐章推进，一次只写当前下一章；不要一次生成多章或多篇正文，除非用户明确要求批量生成。
- 修订直接覆盖同一章节文件，让 git diff 承担版本历史；不要新建 \`草稿/\` 或 \`定稿/\` 目录。
- 实验、被废弃的章节版本、试写和审校笔记放 \`自由区/\`，不要污染 \`正文/\`。
- 正文/ 可以按卷、篇或阶段建立子目录；自由区/ 可以自由创建文件和文件夹。

## 风格默认值

- 默认中文第一人称口语化叙事，章节标题就是钩子，开篇直接进冲突。
- 前三章按留存功能设计：第 1 章拉新，第 2 章加压，第 3 章锁留存；不要把关键承诺拖到三章以后才出现。
- 正文不能写淡；写作前读取 简报.md 的小说密度、事件密度和情绪调动程度，并在每章里维持对应强度。
- 生动度硬规则：高压开场、连续阻断、即时兑现、场景可视化、情绪账本、章尾强悬念；如果当前章节缺少这些发动机，先补结构再润色。
- 短句、对白驱动、情绪显性；遇到长段先看 创作要求.md 是否允许。
- 设定、人物动机、关键道具一律以 简报.md / 人物.md / 素材.md 为准；冲突时回头改这几份。

## 启动说明

${pack.starterMessage}
`;
}

function createClaudeBookAgentInstructions(): string {
  return `# Claude-Book Novel Method Pack

本项目使用 \`novel.claude-book\` Method Pack。

${createChineseRuntimeSummary(CLAUDE_BOOK_METHOD_PACK)}

## 工作流硬门禁

- 在 story/synopsis.md 和 story/plan.md 仍为空模板前，不要写入或更新 story/chapters/。
- 正文章节数量与顺序必须来自 story/plan.md。
- 每章先经过 .work/chapter-XX-plan.md 和 .work/chapter-XX-draft.md，再接受进入 story/chapters/。
- 每个已接受章节之后，先更新 state/current/ 和 timeline/，再开始下一章。
- 自然叙事段落通常保持 2-5 句；除对白、列表或刻意强调外，避免一行一句的正文。

## 初始创作请求门禁

- 不要从宽泛的首轮请求直接起草正文。
- 先使用相关规划、构思或信息收集 skill，并检查 story/synopsis.md、story/plan.md、bible/、state/ 和 timeline/。
- 从用户输入中提取已知约束，只追问会实质改变方法、读者承诺、结构、角色设定或章节计划的缺失决策。

除非用户明确要求，章节起草期间不要修改 bible/。
`;
}

function createAgentInstructions(pack: MethodPack): string {
  if (pack.id === "novel.claude-book") {
    return createClaudeBookAgentInstructions();
  }

  if (pack.id === "short-form.article") {
    return createShortFormAgentInstructions(pack);
  }

  return `# ${pack.displayName}

本项目使用 \`${pack.id}\` Method Pack。

${createChineseRuntimeSummary(pack)}

## 工作流门禁

- 已接受正文必须和草稿、临时分析、审校报告分开保存。
- 后续会依赖的持久事实，先写入该 Method Pack 的正典、知识库或简报文件。
- 修复脚手架时不要覆盖用户已经写过的项目文件。
- 分析、对标、批评、研究材料不要写入已接受正文，除非用户明确要求。

## 初始创作请求门禁

- 不要从宽泛的首轮请求直接起草正文。
- 先使用该 Method Pack 的基础路由或信息收集 skill，例如 \`story\`、\`story-ideator\`、\`project-setup\`，或 \`skills/\` 下其他 setup-oriented skill。
- 从用户输入中提取已知约束，识别缺失的关键方法选择，只追问会实质改变大纲、市场赛道、节奏、视角、关系设置或生产约束的问题。
- 信息收集层形成可用简报后，再进入大纲、黄金章节、分集地图或正文草稿。

## 启动说明

${pack.starterMessage}
`;
}

function getNoticeFileName(pack: MethodPack): string {
  switch (pack.id) {
    case "novel.claude-book":
      return "NOTICE-Claude-Book.md";
    case "novel.oh-story":
      return "NOTICE-Oh-Story.md";
    case "novel.crucible":
      return "NOTICE-Crucible.md";
    case "novel.creative-writing":
      return "NOTICE-Creative-Writing-Skills.md";
    case "short-form.article":
      return "NOTICE-Short-Form-Writing.md";
  }
}

function createNotice(pack: MethodPack): string {
  if (pack.id === "novel.claude-book") {
    return getClaudeBookNotice();
  }

  return `# ${pack.source.name} Notice

This project includes a Craft Agent method-pack adapter inspired by ${pack.source.name}.

- Source: ${pack.source.url}
- Inspected commit: ${pack.source.inspectedCommit}
- Upstream license: ${pack.source.license}

The scaffold and bundled skills in this workspace rewrite the workflow concepts for Craft Agent's workspace and skill model. Upstream license terms continue to apply to adapted concepts and any upstream material a project owner chooses to copy in separately.
`;
}

function scaffoldClaudeBook(rootPath: string): void {
  for (const dir of [
    "bible/characters",
    "bible/universe",
    "story/chapters",
    "state/current",
    "state/template",
    "timeline",
    "analysis/src",
    "analysis/output",
    ".work",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, "bible/style.md"), `# Style Guide

## Voice

## Point of View

## Tense

## Dialogue

## Constraints
`);
  writeFileIfMissing(join(rootPath, "bible/structure.md"), `# Narrative Structure

## Chapter Pattern

## Pacing

## Openings

## Endings
`);
  writeFileIfMissing(join(rootPath, "bible/characters/_template.md"), `# Character Name

## Identity

## Role

## Traits

## Voice

## Relationships
`);
  writeFileIfMissing(join(rootPath, "bible/universe/_template.md"), `# Location Name

## Description

## Atmosphere

## Story Function
`);
  writeFileIfMissing(join(rootPath, "story/synopsis.md"), `# Synopsis

## Logline

## Setup

## Conflict

## Resolution
`);
  writeFileIfMissing(join(rootPath, "story/plan.md"), `# Chapter Plan

## Chapters
`);
  const chaptersPath = join(rootPath, "story/chapters");
  if (!hasManuscriptFile(chaptersPath)) {
    writeFileIfMissing(join(chaptersPath, "chapter-01.md"), `# Chapter 1

`);
  }
  writeFileIfMissing(join(rootPath, "story/chapters/.gitkeep"), "");
  writeFileIfMissing(join(rootPath, ".work/.gitkeep"), "");
  writeFileIfMissing(join(rootPath, "state/current/situation.md"), `# Current Situation

## Immediate Context

## What Just Happened

## Immediate Problem

## Open Hooks
`);
  writeFileIfMissing(join(rootPath, "state/current/characters.md"), `# Character States

## Characters
`);
  writeFileIfMissing(join(rootPath, "state/current/knowledge.md"), `# Knowledge State

## Known To All

## Known To Specific Characters

## Unknown
`);
  writeFileIfMissing(join(rootPath, "state/template/situation.md"), `# Current Situation

## Immediate Context

## What Just Happened

## Immediate Problem

## Open Hooks
`);
  writeFileIfMissing(join(rootPath, "state/template/characters.md"), `# Character States

## Characters
`);
  writeFileIfMissing(join(rootPath, "state/template/knowledge.md"), `# Knowledge State

## Known To All

## Known To Specific Characters

## Unknown
`);
  writeFileIfMissing(join(rootPath, "timeline/history.md"), `# Timeline History
`);
  writeFileIfMissing(join(rootPath, "timeline/current-chapter.md"), `# Current Chapter Timeline
`);
}

function scaffoldOhStory(rootPath: string): void {
  for (const dir of [
    "设定/世界观",
    "设定/角色",
    "设定/势力",
    "大纲",
    "正文",
    "对标",
    "拆文库",
    "追踪",
    "参考资料",
    ".work",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, "设定/关系.md"), `# Relationships

## Character Map
`);
  writeFileIfMissing(join(rootPath, "设定/题材定位.md"), `# Genre Positioning

## Platform

## Genre Lane

## Core Hook

## Target Reader Promise

## Benchmarks
`);
  writeFileIfMissing(join(rootPath, "大纲/大纲.md"), `# Master Outline

## Volumes

## Chapter Plan
`);
  writeFileIfMissing(join(rootPath, "追踪/上下文.md"), `# Writing Context

## Current Position

## Active Constraints
`);
  writeFileIfMissing(join(rootPath, "追踪/伏笔.md"), `# Foreshadowing Tracker

| Setup | Location | Status | Payoff |
| --- | --- | --- | --- |
`);
  writeFileIfMissing(join(rootPath, "追踪/时间线.md"), `# Timeline
`);
  for (const dir of ["正文", "对标", "拆文库", "参考资料", ".work"]) {
    writeFileIfMissing(join(rootPath, dir, ".gitkeep"), "");
  }
}

function scaffoldCrucible(rootPath: string): void {
  for (const dir of [
    ".crucible/state",
    "planning/forge-points",
    "outline/by-chapter",
    "draft/chapters",
    "draft/reviews",
    ".work",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, ".crucible/state/planning-state.json"), `${JSON.stringify({
    phase: "planning",
    completedDocuments: [],
  }, null, 2)}\n`);
  writeFileIfMissing(join(rootPath, "planning/CLAUDE.md"), `# Crucible Planning Context

Use planning documents as canon for outline and draft work.
`);
  writeFileIfMissing(join(rootPath, "planning/crucible-thesis.md"), `# Crucible Thesis

## Core Forging Question

## Quest Strand

## Fire Strand

## Constellation Strand
`);
  writeFileIfMissing(join(rootPath, "planning/quest-strand-map.md"), `# Quest Strand Map
`);
  writeFileIfMissing(join(rootPath, "planning/fire-strand-map.md"), `# Fire Strand Map
`);
  writeFileIfMissing(join(rootPath, "planning/constellation-strand-map.md"), `# Constellation Strand Map
`);
  writeFileIfMissing(join(rootPath, "planning/forge-points/README.md"), `# Forge Points

## Ignition Forge

## First Crucible

## Second Crucible

## Third Crucible

## Apex Willed Surrender
`);
  writeFileIfMissing(join(rootPath, "planning/mercy-ledger.md"), `# Mercy Ledger

| Act | Cost | Witness | Payoff |
| --- | --- | --- | --- |
`);
  writeFileIfMissing(join(rootPath, "planning/dark-mirror-profile.md"), `# Dark Mirror Profile
`);
  writeFileIfMissing(join(rootPath, "planning/world-forge.md"), `# World Forge
`);
  writeFileIfMissing(join(rootPath, "outline/master-outline.md"), `# Master Outline

## Movements

## 36 Beats

## Chapter Map
`);
  writeFileIfMissing(join(rootPath, "story-bible.json"), `${JSON.stringify({
    characters: [],
    locations: [],
    rules: [],
  }, null, 2)}\n`);
  writeFileIfMissing(join(rootPath, "style-profile.md"), `# Style Profile

## Voice

## Prose Rules
`);
  for (const dir of ["outline/by-chapter", "draft/chapters", "draft/reviews", ".work"]) {
    writeFileIfMissing(join(rootPath, dir, ".gitkeep"), "");
  }
}

function scaffoldCreativeWriting(rootPath: string): void {
  for (const dir of [
    "story/chapters",
    "work/outline",
    "work/drafts",
    "work/critique-reports",
    "work/brainstorm",
    "kb/styles",
    "kb/characters",
    "kb/world",
    "kb/timeline",
    "kb/canon",
    "kb/issues",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, "story/README.md"), `# Story

Accepted manuscript lives under story/chapters/.
`);
  writeFileIfMissing(join(rootPath, "work/README.md"), `# Work

Temporary outlines, drafts, critique reports, and brainstorm artifacts live here.
`);
  writeFileIfMissing(join(rootPath, "kb/README.md"), `# Knowledge Base

Durable project knowledge lives here. Keep it concise, factual, and source-aware.
`);
  writeFileIfMissing(join(rootPath, "kb/timeline/timeline.md"), `# Timeline
`);
  writeFileIfMissing(join(rootPath, "kb/canon/facts.md"), `# Canon Facts

## Established

## Unresolved
`);
  for (const dir of [
    "story/chapters",
    "work/outline",
    "work/drafts",
    "work/critique-reports",
    "work/brainstorm",
    "kb/styles",
    "kb/characters",
    "kb/world",
    "kb/issues",
  ]) {
    writeFileIfMissing(join(rootPath, dir, ".gitkeep"), "");
  }
}

function scaffoldShortForm(rootPath: string): void {
  for (const dir of [
    "正文",
    "自由区",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, "创作要求.md"), `# 创作要求

> 跨项目长期生效的写作风格、读者偏好、禁区。每个新项目都会复制这份模板。

## 我喜欢的题材

## 我喜欢的叙事风格

- 视角偏好（如：第一人称、女主第一人称、双视角切换）：
- 语气与节奏（如：口语、短句、对白驱动）：
- 段落长度倾向：
- 章节长度倾向：

## 钩子与节奏

- 开篇方式偏好：
- 章节收尾方式偏好：
- 反转节奏：

## 默认密度偏好

- 小说密度（低 / 中 / 高 / 极高）：
- 事件密度（低 / 中 / 高 / 极高）：
- 情绪调动程度（克制 / 中等 / 强 / 极强）：
- 信息压缩偏好（舒展 / 标准 / 紧凑）：
- 是否允许高频反转：

## 生动度底线

- 高压开场：前 300 字是否必须出现异常、威胁、羞辱、损失或不可逆变化：
- 连续阻断：主角获得优势后是否必须立刻遇到新代价、新敌人或更大问题：
- 即时兑现：每章至少兑现的爽点、反击、真相或能力展示：
- 场景可视化：关键段落必须出现的可见物、声音、触感或空间运动：
- 情绪账本：本书优先递进的情绪（压抑 / 愤怒 / 兴奋 / 恐惧 / 爽感 / 其他）：
- 章尾强悬念：结尾优先使用新危险 / 新秘密 / 新目标 / 新选择：

## 不能触碰的红线

## 我反感的写法
`);

  writeFileIfMissing(join(rootPath, "简报.md"), `# 简报

> 当前这本书的题材、卖点、目标读者、核心钩子与成功条件。简报变化时整体回看大纲。

## 题材定位

- 赛道（如：情感反转 / 复仇打脸 / 追妻火葬场 / 马甲爽文 / 其他）：
- 一句话卖点：
- 对标作品或桥段：

## 主角设置

- 性别 / 身份 / 起点：
- 核心动机：
- 反向标签（角色身上最反差的一点）：

## 目标读者

- 谁会一口气追完：
- 他们要什么情绪回报：

## 核心钩子

- 第一章钩子（一句话）：
- 全书最大的反转：
- 结尾要给的情绪落点：
- 黄金三章的留存承诺：

## 黄金三章留存设计

### 第 1 章：拉新

- 开篇冲突：
- 主角第一印象：
- 最大钩子：
- 章末问题：

### 第 2 章：加压

- 新压力：
- 代价升级：
- 爽点或痛点兑现：
- 章末反转：

### 第 3 章：锁留存

- 阶段兑现：
- 更大的问题：
- 主角主动选择：
- 后续追读理由：

## 密度与情绪选择

- 小说密度（低 / 中 / 高 / 极高）：
- 事件密度（低 / 中 / 高 / 极高）：
- 情绪调动程度（克制 / 中等 / 强 / 极强）：
- 信息压缩方式（舒展 / 标准 / 紧凑）：
- 本书是否允许高频反转：

## 生动度执行标准

- 高压开场：
- 连续阻断：
- 即时兑现：
- 场景可视化：
- 情绪账本：
- 章尾强悬念：

## 篇幅与节奏

- 目标章节数：
- 单章字数：
- 总字数目标：

## 成功条件

- 哪些章节必须让读者停不下来：
- 哪些情绪必须被兑现：
- 哪些设定不能崩：
`);

  writeFileIfMissing(join(rootPath, "大纲.md"), `# 大纲

> 分章 beat 计划。每章一段，必须包含钩子、冲突、反转点和情绪落点。简报变化时整体回扫这份大纲。

## 全书弧线

- 起：
- 承：
- 转：
- 合：

## 黄金三章摘要

- 第 01 章拉新：
- 第 02 章加压：
- 第 03 章锁留存：

## 分章 beat

### 第 01 章

- 章节钩子：
- 主要事件：
- 反转 / 信息差：
- 情绪落点：
- 章末勾子：

### 第 02 章

- 章节钩子：
- 主要事件：
- 反转 / 信息差：
- 情绪落点：
- 章末勾子：
`);

  writeFileIfMissing(join(rootPath, "人物.md"), `# 人物

> 主要角色档案。出场前先建档，避免动机和口吻在正文里漂移。

## 主角

- 名字 / 称呼：
- 身份 / 背景：
- 核心动机：
- 标志性口头禅 / 说话风格：
- 弱点 / 心理伤口：
- 成长弧线：

## 关键配角

### 角色 A

- 名字：
- 与主角的关系：
- 在本书的功能（推动反转 / 制造冲突 / 情感对照 / 其他）：
- 口吻与举止：

## 反派 / 阻力

- 名字：
- 与主角的对立点：
- 不写成纸片人需要保留的灰度：

## 关系网

- 主要关系节点：
- 易混淆的称呼或身份：
`);

  writeFileIfMissing(join(rootPath, "素材.md"), `# 素材

> 题材所需的地点、行业、案例、对标桥段、可复用台词。正文里出现的具体细节优先来自这里。

## 地点 / 场景

| 地点 | 用途 | 关键细节 |
| --- | --- | --- |

## 行业 / 专业知识

| 主题 | 关键事实 | 用法 |
| --- | --- | --- |

## 对标桥段

| 来源 | 桥段 | 想借用的效果 |
| --- | --- | --- |

## 可复用台词

| 场景 | 台词 | 出自谁 |
| --- | --- | --- |
`);

  writeFileIfMissing(join(rootPath, "自由区", ".gitkeep"), "");
  writeFileIfMissing(join(rootPath, "正文", ".gitkeep"), "");
}

function scaffoldPackSpecificFiles(rootPath: string, pack: MethodPack): void {
  switch (pack.id) {
    case "novel.claude-book":
      scaffoldClaudeBook(rootPath);
      return;
    case "novel.oh-story":
      scaffoldOhStory(rootPath);
      return;
    case "novel.crucible":
      scaffoldCrucible(rootPath);
      return;
    case "novel.creative-writing":
      scaffoldCreativeWriting(rootPath);
      return;
    case "short-form.article":
      scaffoldShortForm(rootPath);
      return;
  }
}

export function createNovelProjectScaffold(
  rootPath: string,
  options: CreateNovelProjectScaffoldOptions = {}
): void {
  const pack = resolveMethodPack(options.methodPackId);

  scaffoldPackSpecificFiles(rootPath, pack);

  writeFileIfMissing(
    join(rootPath, "craft-writing.json"),
    `${JSON.stringify(createManifest(options, pack), null, 2)}\n`
  );
  writeFileIfMissing(join(rootPath, "craft-pack-lock.json"), createPackLock(pack));
  writeFileIfMissing(join(rootPath, "AGENTS.md"), createAgentInstructions(pack));
  writeFileIfMissing(join(rootPath, "CLAUDE.md"), createAgentInstructions(pack));
  writeFileIfMissing(join(rootPath, getNoticeFileName(pack)), createNotice(pack));

  for (const file of getBundledNovelSkillFiles(pack.id)) {
    writeFileIfMissing(join(rootPath, "skills", file.relativePath), file.content);
  }
}
