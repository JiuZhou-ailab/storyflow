// input: Creative Writing Skills workflow contract
// output: Built-in Method Pack definition for knowledge-base-driven fiction projects
// pos: Source-of-truth metadata for the Creative Writing Skills creation option

import type { MethodPack } from "./types.ts";

export const CREATIVE_WRITING_METHOD_PACK: MethodPack = {
  id: "novel.creative-writing",
  version: 1,
  displayName: "Creative Writing Skills Pack",
  projectType: "novel",
  storageProfile: "creative-writing-compatible",
  source: {
    name: "creative-writing-skills",
    url: "https://github.com/haowjy/creative-writing-skills",
    license: "Apache-2.0",
    inspectedCommit: "617e9bfb0c1cd6402a3fb9acab7a83eff509f77b",
  },
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: "story/chapters", kind: "directory" },
    { path: "work/outline", kind: "directory" },
    { path: "work/drafts", kind: "directory" },
    { path: "work/critique-reports", kind: "directory" },
    { path: "work/brainstorm", kind: "directory" },
    { path: "kb/styles", kind: "directory" },
    { path: "kb/characters", kind: "directory" },
    { path: "kb/world", kind: "directory" },
    { path: "kb/timeline/timeline.md", kind: "file" },
    { path: "kb/canon/facts.md", kind: "file" },
    { path: "kb/issues", kind: "directory" },
  ],
  requiredSkills: [
    "project-setup",
    "writing-principles",
    "prose-writing",
    "scene-construction",
    "prose-critique",
    "style-analysis",
    "story-architecture",
    "story-context",
    "brainstorming",
    "kb-management",
    "writing-artifacts",
    "writing-issues",
    "writing-staffing",
  ],
  runtimePreamble: "This project uses the novel.creative-writing method pack. Use kb/ for durable canon and style knowledge, work/ for temporary exploration, drafts, critiques, and outlines, and story/chapters/ for accepted manuscript.",
  starterMessage: `## 这是什么

这是 Creative Writing Skills 技法工坊工作区，适合流程需要保持弹性，但仍要沉淀知识库、声线参考、草稿、批评报告和修订循环的小说项目。

## 我会怎么做

我会先把已有素材整理进知识库，区分 canon、声线、角色、世界、时间线和开放问题。之后根据当前任务选择头脑风暴、大纲、起草、批评、风格分析或修订流程。

## 流程

1. 建立知识库和声线参考。
2. 明确当前创作目标和约束。
3. 选择最小可用的写作技能流程。
4. 生成草稿、批评报告或修订稿。
5. 把已确认事实和经验回写知识库。

## 你现在可以提供

请提供项目 premise、当前稿件状态、声线参考、重要 canon、已有片段，以及你希望先做头脑风暴、大纲、风格捕捉、起草、批评还是修订。`,
};
