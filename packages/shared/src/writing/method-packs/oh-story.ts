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
  starterMessage: "I created an Oh Story web-fiction workspace. Start by choosing long-form or short-form web-fiction, target platform, genre lane, core hook, target emotion, benchmark titles, and update cadence. I can then build the market positioning, outline, character setup, and first chapter plan.",
};
