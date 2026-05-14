// input: Crucible Structure workflow contract
// output: Built-in Method Pack definition for 36-beat fantasy novel projects
// pos: Source-of-truth metadata for the Crucible creation option

import type { MethodPack } from "./types.ts";

export const CRUCIBLE_METHOD_PACK: MethodPack = {
  id: "novel.crucible",
  version: 1,
  displayName: "Crucible Structure Pack",
  projectType: "novel",
  storageProfile: "crucible-compatible",
  source: {
    name: "The Crucible Writing System For Claude",
    url: "https://github.com/forsonny/The-Crucible-Writing-System-For-Claude",
    license: "MIT",
    inspectedCommit: "0d82e733536d70358259f93d66cc40708077898e",
  },
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: ".crucible/state/planning-state.json", kind: "file" },
    { path: "planning/CLAUDE.md", kind: "file" },
    { path: "planning/crucible-thesis.md", kind: "file" },
    { path: "planning/quest-strand-map.md", kind: "file" },
    { path: "planning/fire-strand-map.md", kind: "file" },
    { path: "planning/constellation-strand-map.md", kind: "file" },
    { path: "planning/forge-points", kind: "directory" },
    { path: "planning/mercy-ledger.md", kind: "file" },
    { path: "planning/dark-mirror-profile.md", kind: "file" },
    { path: "planning/world-forge.md", kind: "file" },
    { path: "outline/master-outline.md", kind: "file" },
    { path: "outline/by-chapter", kind: "directory" },
    { path: "draft/chapters", kind: "directory" },
    { path: "draft/reviews", kind: "directory" },
    { path: "story-bible.json", kind: "file" },
    { path: "style-profile.md", kind: "file" },
    { path: ".work", kind: "directory" },
  ],
  requiredSkills: [
    "crucible-planner",
    "crucible-outliner",
    "crucible-writer",
    "crucible-editor",
    "crucible-reviewer",
  ],
  runtimePreamble: "This project uses the novel.crucible method pack. Treat planning/ as the 36-beat source of truth, outline/ as the chapter contract, draft/chapters/ as manuscript, draft/reviews/ as review output, and .crucible/state/ as workflow state.",
  agentIdentity: "You are a Crucible 36-beat fantasy structure architect who protects thematic pressure, three-strand progression, forge points, mercy ledger, and chapter contracts before prose.",
  defaultSkill: "crucible-planner",
  alwaysOnInstructions: "Treat planning/ as the durable structural source of truth, outline/ as the accepted chapter contract, draft/chapters/ as manuscript, draft/reviews/ as critique output, .crucible/state/ as workflow state, story-bible.json as canon, style-profile.md as prose and voice guidance, and .work/ as temporary exploration.",
  initialRequestPolicy: "Do not draft directly from a broad first writing request. First use crucible-planner to establish thesis, protagonist burden, quest strand, fire strand, constellation strand, dark mirror, world constraints, mercy ledger, and expected ending shape before outlining or drafting.",
  artifactContract: [
    { path: "planning/", role: "Durable 36-beat planning source for thesis, strands, forge points, mercy ledger, mirror, and world constraints.", lifecycle: "canon" },
    { path: "outline/master-outline.md", role: "Accepted full-book structure and chapter-level contract.", lifecycle: "outline" },
    { path: "outline/by-chapter/", role: "Per-chapter beats, pressure points, and draft entry criteria.", lifecycle: "outline" },
    { path: "draft/chapters/", role: "Chapter manuscript drafts and accepted prose.", lifecycle: "draft" },
    { path: "draft/reviews/", role: "Structural, continuity, and style review reports.", lifecycle: "review" },
    { path: ".crucible/state/", role: "Workflow state, planning progress, and next-step status.", lifecycle: "state" },
    { path: "story-bible.json", role: "Canonical story facts used to keep the structure and manuscript consistent.", lifecycle: "canon" },
    { path: "style-profile.md", role: "Voice, prose constraints, and stylistic quality bar.", lifecycle: "canon" },
    { path: ".work/", role: "Temporary scratch planning, exploratory drafts, and intermediate notes.", lifecycle: "draft" },
  ],
  skillRouting: [
    { when: "initial premise, thesis, strands, or ending shape are unclear", skill: "crucible-planner" },
    { when: "36-beat plan must become chapter structure", skill: "crucible-outliner" },
    { when: "chapter outline is accepted and prose is requested", skill: "crucible-writer" },
    { when: "chapter needs revision against structure or voice", skill: "crucible-editor" },
    { when: "draft, outline, or plan needs Crucible quality gate review", skill: "crucible-reviewer" },
  ],
  starterMessage: `## 这是什么

这是 Crucible 36-beat 结构长篇工作区，适合用三条叙事线、forge points、mercy ledger 和章节审校关卡管理强结构故事。

## 我会怎么做

我会先把故事命题拆成外部任务线、内部火焰线和关系压力线，再把三条叙事线压入 36-beat 结构。之后用 forge points 检查关键转折是否同时推动任务、内心和关系。

## 流程

1. 定义主题、主角负担、反派镜像和结局形状。
2. 拆出三条叙事线。
3. 生成 36-beat 结构和 forge points。
4. 转成章节大纲。
5. 起草章节，并按结构、连续性和声线做审校。

## 你现在可以提供

请提供故事 premise、主角负担、外部任务线、内部火焰线、关键关系、反派镜像、世界约束和期望结局形状。`,
};
