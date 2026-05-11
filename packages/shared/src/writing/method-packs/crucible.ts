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
  starterMessage: "I created a Crucible 36-beat novel workspace. Start with a premise, protagonist burden, external quest, internal fire, key relationships, antagonist mirror, and desired ending shape. I can guide the planning pass into the three strands, forge points, mercy ledger, and chapter outline.",
};
