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
  starterMessage: "I created a Claude-Book novel workspace for this project. Start by defining the bible, synopsis, and chapter plan before drafting chapters. Share the premise, genre, target reader, point of view, tone, and any must-keep constraints, and I can turn them into the first canon and outline files.",
};
