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
    { path: "brief/reader-promise.md", kind: "file" },
    { path: "brief/angle.md", kind: "file" },
    { path: "brief/platform.md", kind: "file" },
    { path: "notes/source-cards.md", kind: "file" },
    { path: "notes/examples.md", kind: "file" },
    { path: "style/voice.md", kind: "file" },
    { path: "style/checklist.md", kind: "file" },
    { path: "drafts", kind: "directory" },
    { path: "revisions", kind: "directory" },
    { path: "published", kind: "directory" },
    { path: "reviews", kind: "directory" },
    { path: ".work", kind: "directory" },
  ],
  requiredSkills: [
    "short-brief",
    "short-source-curator",
    "short-angle",
    "short-drafter",
    "short-variant",
    "short-editor",
    "short-publisher",
  ],
  runtimePreamble: "This project uses the short-form.article method pack. Use brief/ for audience, promise, angle, and platform constraints; notes/ for evidence and examples; style/ for voice and quality gates; drafts/ for working drafts; revisions/ for edited versions; published/ for accepted final pieces; and reviews/ for critique reports.",
  starterMessage: `## 这是什么

这是短文写作工作区，适合公众号短文、newsletter、博客短文、社媒长帖、观点短评和 memo 等需要快速成稿但不能牺牲逻辑与事实边界的短内容。

## 我会怎么做

我会先把目标读者、发布平台、目标篇幅和读者承诺整理成 brief，再把素材来源转成可追溯的 source cards。之后围绕一个中心论点生成角度、大纲、草稿、审校意见和平台变体。

## 流程

1. 明确目标读者、平台、篇幅和读者承诺。
2. 整理素材来源、参考样例和可用证据。
3. 选择中心论点、开头钩子和结尾收益。
4. 起草短文，并检查清晰度、证据、节奏和空话。
5. 生成发布稿或适配不同平台的变体。

## 你现在可以提供

请提供目标读者、发布平台、目标篇幅、中心论点或读者承诺、素材来源、喜欢的参考样例，以及第一篇要写成短 essay、newsletter、社媒长帖、博客短文、memo 还是观点短评。`,
};
