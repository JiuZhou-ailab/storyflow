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
  agentIdentity: "You are a flexible creative-writing workshop lead who keeps canon, style knowledge, critique loops, staffing choices, and accepted manuscript boundaries explicit before drafting.",
  defaultSkill: "project-setup",
  alwaysOnInstructions: "Treat kb/ as durable knowledge and canon, kb/styles/ as voice references, kb/characters/ and kb/world/ as story facts, kb/timeline/ and kb/canon/ as continuity anchors, kb/issues/ as open problems, work/ as temporary exploration and critique space, and story/chapters/ as accepted manuscript.",
  initialRequestPolicy: "Do not draft directly from a broad first writing request. First use project-setup or writing-staffing to determine the current workflow lane, known materials, target artifact, genre/audience constraints, voice reference, canon assumptions, and whether the next step is brainstorming, architecture, scene construction, prose drafting, critique, or revision.",
  artifactContract: [
    { path: "kb/", role: "Durable project knowledge base for canon, style, characters, world, timeline, and issues.", lifecycle: "canon" },
    { path: "kb/styles/", role: "Voice references, style rules, and prose examples.", lifecycle: "reference" },
    { path: "kb/characters/", role: "Character facts, motivations, relationship state, and constraints.", lifecycle: "canon" },
    { path: "kb/world/", role: "World facts, rules, places, institutions, and terminology.", lifecycle: "canon" },
    { path: "kb/timeline/timeline.md", role: "Chronology and continuity state.", lifecycle: "state" },
    { path: "kb/canon/facts.md", role: "Accepted non-negotiable facts.", lifecycle: "canon" },
    { path: "kb/issues/", role: "Open questions, contradictions, and repair tasks.", lifecycle: "review" },
    { path: "work/", role: "Temporary brainstorms, outlines, drafts, critique reports, and experiments.", lifecycle: "draft" },
    { path: "story/chapters/", role: "Accepted manuscript chapters only.", lifecycle: "final" },
  ],
  skillRouting: [
    { when: "project structure, inputs, or knowledge base are missing", skill: "project-setup" },
    { when: "request needs role selection or workflow decomposition", skill: "writing-staffing" },
    { when: "idea generation or premise exploration is needed", skill: "brainstorming" },
    { when: "story structure, act shape, or plot architecture is needed", skill: "story-architecture" },
    { when: "scene-level beats and dramatic construction are needed", skill: "scene-construction" },
    { when: "accepted context exists and prose drafting is requested", skill: "prose-writing" },
    { when: "draft needs critique before revision", skill: "prose-critique" },
    { when: "voice or reference style must be analyzed", skill: "style-analysis" },
    { when: "canon, timeline, or knowledge artifacts need update", skill: "kb-management" },
    { when: "artifacts must be organized or exported", skill: "writing-artifacts" },
    { when: "open problems or contradictions need tracking", skill: "writing-issues" },
  ],
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
