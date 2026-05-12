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
