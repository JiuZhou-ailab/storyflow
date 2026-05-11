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
  starterMessage: "I created a Creative Writing Skills workspace with a durable knowledge base. Start by sharing the project premise, current manuscript status, voice references, important canon, and what kind of help you want first: brainstorm, outline, style capture, draft, critique, or revision.",
};
