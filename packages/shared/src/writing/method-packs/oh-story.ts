// input: Oh Story web-fiction workflow contract
// output: Built-in Method Pack definition for online fiction projects
// pos: Source-of-truth metadata for the Oh Story creation option

import type { MethodPack } from "./types.ts";

export const OH_STORY_METHOD_PACK: MethodPack = {
  id: "novel.oh-story",
  version: 1,
  displayName: "Oh Story Web Fiction Pack",
  projectType: "novel",
  storageProfile: "oh-story-compatible",
  source: {
    name: "oh-story-claudecode",
    url: "https://github.com/worldwonderer/oh-story-claudecode",
    license: "MIT",
    inspectedCommit: "7265cf2c47fca57fb3e16206241b28a5cec80eff",
  },
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: "设定/世界观", kind: "directory" },
    { path: "设定/角色", kind: "directory" },
    { path: "设定/势力", kind: "directory" },
    { path: "设定/关系.md", kind: "file" },
    { path: "设定/题材定位.md", kind: "file" },
    { path: "大纲/大纲.md", kind: "file" },
    { path: "正文", kind: "directory" },
    { path: "对标", kind: "directory" },
    { path: "拆文库", kind: "directory" },
    { path: "追踪/上下文.md", kind: "file" },
    { path: "追踪/伏笔.md", kind: "file" },
    { path: "追踪/时间线.md", kind: "file" },
    { path: "参考资料", kind: "directory" },
    { path: ".work", kind: "directory" },
  ],
  requiredSkills: [
    "story-setup",
    "story",
    "story-long-scan",
    "story-long-analyze",
    "story-long-write",
    "story-short-scan",
    "story-short-analyze",
    "story-short-write",
    "story-deslop",
    "story-review",
    "story-cover",
  ],
  runtimePreamble: "This project uses the novel.oh-story method pack. Use 设定/ for canon, 大纲/ for book and chapter planning, 正文/ for manuscript, 追踪/ for continuity and foreshadowing, 拆文库/ and 对标/ for benchmark analysis, and 参考资料/ for research.",
  agentIdentity: "You are an Oh Story web-fiction planning editor who optimizes genre promise, platform rhythm, emotional payoff, benchmark learning, and serial-reader momentum before drafting.",
  defaultSkill: "story",
  alwaysOnInstructions: "Treat 设定/ as durable canon, 设定/题材定位.md as the market and reader-promise contract, 大纲/大纲.md as the plot contract, 正文/ as accepted prose, 追踪/ as continuity and foreshadowing state, 拆文库/ and 对标/ as benchmark evidence, 参考资料/ as source material, and .work/ as temporary exploration.",
  initialRequestPolicy: "Do not draft directly from a broad first writing request. First use story to classify the request lane and clarify method-defining dimensions such as 男频/女频/双男主, genre promise, protagonist setup, emotional engine, reversal rhythm, payoff, length, and whether the next artifact should be positioning, outline, golden opening chapters, or prose.",
  artifactContract: [
    { path: "设定/", role: "Durable canon for world, characters, factions, relationships, terminology, and story constraints.", lifecycle: "canon" },
    { path: "设定/题材定位.md", role: "Reader lane, platform promise, genre expectation, tone, and differentiating hook.", lifecycle: "intake" },
    { path: "大纲/大纲.md", role: "Accepted story structure, arcs, reversals, payoffs, and chapter/section plan.", lifecycle: "outline" },
    { path: "正文/", role: "Accepted manuscript prose only after positioning and outline are clear.", lifecycle: "final" },
    { path: "追踪/", role: "Continuity, context, foreshadowing, timeline, and serialized-state records.", lifecycle: "state" },
    { path: "拆文库/", role: "Benchmark breakdown notes and reusable craft observations.", lifecycle: "reference" },
    { path: "对标/", role: "Comparable works, market references, and platform rhythm examples.", lifecycle: "reference" },
    { path: "参考资料/", role: "Research and source material that should remain traceable.", lifecycle: "reference" },
    { path: ".work/", role: "Temporary intake notes, drafts, experiments, and review reports.", lifecycle: "draft" },
  ],
  skillRouting: [
    { when: "initial creative request needs lane selection or missing method dimensions", skill: "story" },
    { when: "workspace setup or scaffold repair is needed", skill: "story-setup" },
    { when: "long-form benchmark/source text needs extraction", skill: "story-long-scan" },
    { when: "long-form benchmark needs craft analysis", skill: "story-long-analyze" },
    { when: "long-form positioning and outline are accepted and prose is requested", skill: "story-long-write" },
    { when: "short-form story seed or benchmark needs extraction", skill: "story-short-scan" },
    { when: "short-form request needs compact premise, reversal, or payoff analysis", skill: "story-short-analyze" },
    { when: "short-form brief and beats are accepted and prose is requested", skill: "story-short-write" },
    { when: "draft needs AI-flavor cleanup and sharper language", skill: "story-deslop" },
    { when: "draft or outline needs quality review", skill: "story-review" },
    { when: "project needs cover/title/package concept", skill: "story-cover" },
  ],
  starterMessage: `## 这是什么

这是 Oh Story 网文连载工作区，适合围绕题材定位、平台节奏、对标拆文、章节钩子和追读动能推进的网文项目。

## 我会怎么做

我会先明确目标平台、题材赛道和读者承诺，再拆解对标作品的钩子、爽点、节奏和更新策略。之后把定位落到设定、大纲、章节计划和连载追踪里。

## 流程

1. 确定平台、题材、读者承诺和更新节奏。
2. 建立对标作品和拆文库。
3. 生成设定、角色和大纲。
4. 按章节钩子起草正文。
5. 更新伏笔、上下文和时间线，并做去 AI 味清理。

## 你现在可以提供

请说明要做长篇还是短篇网文、目标平台、题材赛道、核心钩子、目标情绪、对标作品、更新节奏，以及你希望第一阶段先做定位、拆文、大纲还是首章。`,
};
