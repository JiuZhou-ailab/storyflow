// input: Short-form writing workflow contract
// output: Built-in Method Pack definition for articles, posts, essays, and concise opinion pieces
// pos: Source-of-truth metadata for the short-form writing creation option

import type { MethodPack } from "./types.ts";

export const SHORT_FORM_METHOD_PACK: MethodPack = {
  id: "short-form.article",
  version: 1,
  displayName: "Short-Form Writing Pack",
  projectType: "short-form",
  storageProfile: "short-form-compatible",
  source: {
    name: "boraoztunc/skills and public short-form writing guidance",
    url: "https://github.com/boraoztunc/skills",
    license: "MIT for skill source; no upstream text copied",
    inspectedCommit: "52eb13623df7f03393b272a43fb76545cdb6cabe",
  },
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: "目录说明.md", kind: "file" },
    { path: "短文简报.md", kind: "file" },
    { path: "素材卡.md", kind: "file" },
    { path: "草稿", kind: "directory" },
    { path: "定稿", kind: "directory" },
    { path: ".work", kind: "directory" },
  ],
  requiredSkills: [
    "short-brief",
    "short-source-curator",
    "short-angle",
    "short-drafter",
    "short-editor",
    "short-publisher",
  ],
  runtimePreamble: "This project uses the short-form.article method pack. Use 短文简报.md for audience, promise, platform, angle, and outline; 素材卡.md for evidence and examples; 草稿/ for working drafts and revisions; 定稿/ for accepted final pieces; and .work/ for temporary outlines, reviews, and discarded alternatives.",
  agentIdentity: "You are a lean short-form editorial agent who turns vague requests into a compact brief, traceable material, draft, edit, and final copy without over-splitting artifacts.",
  defaultSkill: "short-brief",
  alwaysOnInstructions: "Treat 目录说明.md as the file-structure contract, 短文简报.md as the single planning source for reader, platform, angle, outline, voice notes, and quality gates, 素材卡.md as the evidence ledger, 草稿/ as working copy and revisions, 定稿/ as accepted final copy, and .work/ as temporary outlines, reviews, and discarded alternatives.",
  initialRequestPolicy: "Do not draft directly from a broad first writing request. First use short-brief to clarify audience, platform, desired length, reader promise, evidence/source availability, stance, tone, ending payoff, and whether the next artifact should be a brief update, outline, draft, edit, or publishable final.",
  artifactContract: [
    { path: "目录说明.md", role: "Human-readable file structure, lifecycle, and naming contract for the short-form workspace.", lifecycle: "canon" },
    { path: "短文简报.md", role: "Single source for audience, reader promise, platform, angle, outline, voice notes, quality gates, and open decisions.", lifecycle: "intake" },
    { path: "素材卡.md", role: "Traceable source cards, evidence, quotes, examples, benchmark notes, and factual constraints.", lifecycle: "reference" },
    { path: "草稿/", role: "Working drafts, edited drafts, and platform variants before final acceptance.", lifecycle: "draft" },
    { path: "定稿/", role: "Accepted final copy ready for use.", lifecycle: "final" },
    { path: ".work/", role: "Temporary outlines, reviews, discarded angles, and intermediate notes that should not become durable files.", lifecycle: "draft" },
  ],
  namingConventions: [
    { path: "草稿/", pattern: "YYYYMMDD-topic-vNN.md for working drafts before review.", example: "20260513-乡村螃蟹反目-v01.md" },
    { path: "定稿/", pattern: "YYYYMMDD-topic-final.md for accepted publishable copy only.", example: "20260513-乡村螃蟹反目-final.md" },
    { path: ".work/", pattern: "YYYYMMDD-topic-purpose.md for scratch outlines, reviews, rejected angles, and temporary notes.", example: "20260513-乡村螃蟹反目-outline.md" },
  ],
  skillRouting: [
    { when: "initial request lacks audience, platform, angle, or reader promise", skill: "short-brief" },
    { when: "sources, facts, examples, or evidence must be organized", skill: "short-source-curator" },
    { when: "central claim, hook, structure, or ending payoff must be chosen", skill: "short-angle" },
    { when: "brief and angle are accepted and draft copy is requested", skill: "short-drafter" },
    { when: "draft needs revision, platform adaptation, clarity, evidence, rhythm, or anti-fluff editing", skill: "short-editor" },
    { when: "final copy needs publish-ready packaging", skill: "short-publisher" },
  ],
  starterMessage: `## 这是什么

这是短文写作工作区，适合公众号短文、newsletter、博客短文、社媒长帖、观点短评和 memo 等需要快速成稿但不能牺牲逻辑与事实边界的短内容。

## 我会怎么做

我会先把目标读者、发布平台、目标篇幅和读者承诺整理到 短文简报.md，再把素材来源转成可追溯的 素材卡.md。之后围绕一个中心论点生成大纲、草稿、修改意见和定稿，并按目录说明里的命名规则保存。

## 流程

1. 明确目标读者、平台、篇幅和读者承诺。
2. 整理素材来源、参考样例和可用证据。
3. 选择中心论点、开头钩子和结尾收益。
4. 起草短文，并检查清晰度、证据、节奏和空话。
5. 生成发布稿或适配不同平台的变体。

## 你现在可以提供

请提供目标读者、发布平台、目标篇幅、中心论点或读者承诺、素材来源、喜欢的参考样例，以及第一篇要写成短 essay、newsletter、社媒长帖、博客短文、memo 还是观点短评。`,
};
