// input: Claude-Book-compatible novel workspace contract
// output: Built-in Method Pack definition for novel writing projects
// pos: Single source of truth for the initial creative writing method pack

import type { MethodPack } from "./types.ts";

export const CLAUDE_BOOK_METHOD_PACK: MethodPack = {
  id: "novel.claude-book",
  version: 1,
  displayName: "Claude-Book Method Pack",
  projectType: "novel",
  storageProfile: "claude-book-compatible",
  source: {
    name: "Claude-Book",
    url: "https://github.com/ThomasHoussin/Claude-Book",
    license: "MIT",
    inspectedCommit: "3fdebbb576b1be6d123b48258d2310c5dff013c4",
  },
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: "bible/style.md", kind: "file" },
    { path: "bible/structure.md", kind: "file" },
    { path: "bible/characters", kind: "directory" },
    { path: "bible/universe", kind: "directory" },
    { path: "story/synopsis.md", kind: "file" },
    { path: "story/plan.md", kind: "file" },
    { path: "story/chapters", kind: "directory" },
    { path: "state/current/situation.md", kind: "file" },
    { path: "state/current/characters.md", kind: "file" },
    { path: "state/current/knowledge.md", kind: "file" },
    { path: "state/template/situation.md", kind: "file" },
    { path: "state/template/characters.md", kind: "file" },
    { path: "state/template/knowledge.md", kind: "file" },
    { path: "timeline/history.md", kind: "file" },
    { path: "timeline/current-chapter.md", kind: "file" },
    { path: "analysis/src", kind: "directory" },
    { path: "analysis/output", kind: "directory" },
    { path: ".work", kind: "directory" },
  ],
  requiredSkills: [
    "book-analyzer",
    "bible-merger",
    "story-ideator",
    "chapter-workflow",
    "style-reviewer",
    "character-reviewer",
    "continuity-reviewer",
    "state-updater",
  ],
  runtimePreamble: "This project uses the novel.claude-book method pack. Use bible/ as canon, story/chapters/ as manuscript, state/current/ as current continuity state, timeline/ as chronology, and .work/ for drafts and reports.",
  starterMessage: `## 这是什么

这是 Claude-Book 小说工作区，适合需要先建立项目圣经、故事梗概和章节计划，再稳定推进章节起草的长篇小说项目。

## 我会怎么做

我会先把你的故事信息整理成 canon、风格规则、角色与世界设定，再把故事梗概拆成章节计划。进入写作后，每一章都会对齐项目圣经、当前状态和时间线。

## 流程

1. 建立项目圣经和风格约束。
2. 写出故事梗概和章节计划。
3. 按章节计划起草章节。
4. 审查风格、角色和连续性。
5. 接受章节后更新当前状态和时间线。

## 你现在可以提供

请提供故事 premise、题材类型、目标读者、叙述视角、语气风格、主要角色、世界设定，以及必须保留或必须避免的硬约束。`,
};
