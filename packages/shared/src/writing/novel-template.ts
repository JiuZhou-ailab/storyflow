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

- 身份：短文编辑型 Agent，把模糊请求推进为简报、素材、草稿、修改稿和定稿，避免过度拆分文件。
- 默认入口 skill：\`${pack.defaultSkill}\`。
- 初始请求：不要从宽泛首轮请求直接起草正文；先澄清目标读者、发布平台、目标篇幅、读者承诺、素材可用性、立场、语气、结尾收益和下一产物。

## 文件结构契约

- \`目录说明.md\`：人类可读的文件结构、生命周期和命名规则。
- \`短文简报.md\`：目标读者、平台、角度、大纲、声线、质量门槛和开放问题的单一规划源。
- \`素材卡.md\`：来源、事实、引用、例子、对标观察和事实边界。
- \`草稿/\`：工作草稿、修改稿和平台变体。
- \`定稿/\`：已接受、可发布的最终稿。
- \`.work/\`：临时大纲、审校记录、废弃角度和中间笔记。

## 命名规则

- \`草稿/\`：\`YYYYMMDD-topic-vNN.md\`，例如 \`20260513-乡村螃蟹反目-v01.md\`。
- \`定稿/\`：\`YYYYMMDD-topic-final.md\`，例如 \`20260513-乡村螃蟹反目-final.md\`。
- \`.work/\`：\`YYYYMMDD-topic-purpose.md\`，例如 \`20260513-乡村螃蟹反目-outline.md\`。

## Skill 路由

- 首轮请求缺少读者、平台、角度或读者承诺：先用 \`short-brief\`。
- 需要整理事实、例子或证据：使用 \`short-source-curator\`。
- 需要选择中心论点、开头钩子、结构或结尾收益：使用 \`short-angle\`。
- 简报和角度已接受后再使用 \`short-drafter\` 起草。
- 修改、平台适配、清晰度和去空话：使用 \`short-editor\`。
- 需要可发布包装：使用 \`short-publisher\`。`;
  }
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
- 先使用该 Method Pack 的基础路由或信息收集 skill，例如 \`story\`、\`short-brief\`、\`project-setup\`，或 \`skills/\` 下其他 setup-oriented skill。
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
    "草稿",
    "定稿",
    ".work",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, "目录说明.md"), `# 短文工作区目录说明

## 生命周期

| 路径 | 用途 | 何时写入 |
| --- | --- | --- |
| 短文简报.md | 目标读者、平台、篇幅、读者承诺、中心角度、大纲、声线和质量门槛 | 首轮信息收集、定位变化或起草前 |
| 素材卡.md | 来源、事实、引用、例子、对标观察和可信度 | 使用素材前 |
| 草稿/ | 未接受的工作草稿、修改稿和平台变体 | 完成正文或改稿时 |
| 定稿/ | 已接受、可发布的最终稿 | 用户确认或进入发布阶段时 |
| .work/ | 临时大纲、审校记录、废弃角度、草稿碎片 | 不应长期保存的中间工作 |

## 命名规则

- 草稿：\`YYYYMMDD-topic-vNN.md\`，例如 \`20260513-乡村螃蟹反目-v01.md\`。
- 定稿：\`YYYYMMDD-topic-final.md\`，例如 \`20260513-乡村螃蟹反目-final.md\`。
- 临时工作：\`YYYYMMDD-topic-purpose.md\`，例如 \`20260513-乡村螃蟹反目-outline.md\`。

## 写入原则

- 宽泛初始请求先进入 \`短文简报.md\`，不要直接写正文。
- 大纲、角度候选和废弃方向先放 \`.work/\`；被确认的核心角度同步到 \`短文简报.md\`。
- 正文草稿只放 \`草稿/\`，不要写进 \`短文简报.md\` 或 \`素材卡.md\`。
- 平台改写或反馈修改继续放 \`草稿/\` 的新版本，不要覆盖原始草稿。
- 只有被接受的可发布版本进入 \`定稿/\`。
- 审校结论、风险、证据缺口和修改建议放 \`.work/\`。
`);

  writeFileIfMissing(join(rootPath, "短文简报.md"), `# 短文简报

## 目标读者

## 读者问题或欲望

## 读者承诺

## 预期余味

## 发布平台

### 内容形式

### 目标篇幅

### 分发渠道

### 约束

### 行动召唤

## 中心角度

### 核心判断

### 当下理由

### 开头钩子

### 反方或阻力

### 结尾收益

## 大纲

### 开头

### 铺垫

### 支撑

### 转折

### 回报

## 声线备注

### 语气

### 用词

### 句子节奏

### 避免事项

## 质量门槛

- 目标读者和发布平台明确。
- 一个中心判断或读者承诺控制全文。
- 开头快速兑现注意力。
- 每一段都推进判断、证据或回报。

## 清晰度

- 句子直接。
- 段落足够短，便于扫读。
- 抽象判断有例子或证据支撑。
- 结尾兑现承诺的收益。
`);
  writeFileIfMissing(join(rootPath, "素材卡.md"), `# 素材卡

| 来源 | 事实或引用 | 用途 | 可信度 |
| --- | --- | --- | --- |

## 参考样例

| 来源 | 开头钩子 | 结尾方式 | 声线备注 |
| --- | --- | --- | --- |
`);

  for (const dir of ["草稿", "定稿", ".work"]) {
    writeFileIfMissing(join(rootPath, dir, ".gitkeep"), "");
  }
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
