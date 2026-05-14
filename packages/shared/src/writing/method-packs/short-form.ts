// input: Short-form writing workflow contract
// output: Built-in Method Pack definition for 5,000-40,000 character web fiction projects
// pos: Source-of-truth metadata for the short-form writing creation option

import type { MethodPack } from "./types.ts";

export const SHORT_FORM_METHOD_PACK: MethodPack = {
  id: "short-form.article",
  version: 1,
  displayName: "短篇/中篇小说",
  projectType: "short-form",
  storageProfile: "short-form-compatible",
  source: {
    name: "Craft Agent web-fiction short-form template",
    url: "https://github.com/craft-agent/craft-agents-oss",
    license: "internal",
    inspectedCommit: "",
  },
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: "目录说明.md", kind: "file" },
    { path: "创作要求.md", kind: "file" },
    { path: "简报.md", kind: "file" },
    { path: "大纲.md", kind: "file" },
    { path: "人物.md", kind: "file" },
    { path: "素材.md", kind: "file" },
    { path: "正文", kind: "directory" },
    { path: ".work", kind: "directory" },
  ],
  requiredSkills: [],
  runtimePreamble: "This project uses the short-form.article method pack. 创作要求.md carries the long-lived writing style and cross-project conventions; 简报.md captures the current piece's premise, audience, and core hooks; 大纲.md is the chapter beat plan; 人物.md tracks characters; 素材.md collects research and reference material; 正文/ holds the manuscript as one Markdown file per chapter named NN-标题.md; .work/ stores throwaway scratch work. Use git diff for revision history instead of separating drafts and finals.",
  agentIdentity: "你是一名中文短篇/中篇网文（5,000-40,000 字）写作搭档，按 简报.md → 大纲.md → 人物.md / 素材.md → 正文/ 的顺序推进单一作品。优先保护单作品聚焦、第一人称口语化叙事、章节钩子与情绪反转节奏，不要拆出多份草稿目录或多余的工作流文件。",
  defaultSkill: "",
  alwaysOnInstructions: `本工作区遵循以下文件契约：

- 创作要求.md：跨项目长期写作风格、读者偏好与禁区。改动幅度低，通常用户主笔。
- 简报.md：当前这本书的题材、卖点、目标读者、风格选择与核心钩子。
- 大纲.md：分章节 beat 计划，每章一段，含钩子和反转点。
- 人物.md：主要角色档案、关系、口头禅、动机和成长弧线。
- 素材.md：地点、行业知识、参考案例、对标桥段、可复用台词。
- 正文/：唯一的成稿目录，每章一个文件，命名 NN-标题.md（例如 01-未婚夫和闺蜜在我葬礼上接吻.md）。先有 简报.md 与 大纲.md，再进入 正文/。
- .work/：临时大纲实验、被废弃的章节版本、人物试稿和审校笔记。

写作约定：

- 默认中文第一人称，章节标题就是钩子，开篇直接进冲突。
- 修订靠 git diff 留痕，不要新建 草稿/ 或 定稿/ 目录，也不要把多版本塞进同一文件。
- 宽泛的初始请求先把 简报.md 写满，再补 大纲.md，最后才写 正文/。
- 不要预先生成空章节文件，写到哪一章再创建对应 NN-标题.md。`,
  initialRequestPolicy: "在 简报.md 与 大纲.md 仍是模板时不要直接写 正文/。先与用户确认题材定位、主角设置、核心钩子、章节数量与篇幅目标，把答案落到 简报.md 与 大纲.md，再进入 正文/ 中的章节文件。",
  artifactContract: [
    { path: "目录说明.md", role: "面向人的目录契约，描述每个文件的作用、命名规则与写入时机。", lifecycle: "canon" },
    { path: "创作要求.md", role: "跨项目长期写作风格、读者偏好与个人禁区。", lifecycle: "canon" },
    { path: "简报.md", role: "当前作品的题材、卖点、目标读者、核心钩子与成功条件。", lifecycle: "intake" },
    { path: "大纲.md", role: "分章节 beat 计划：每章一段，包含钩子、冲突、反转和情绪落点。", lifecycle: "outline" },
    { path: "人物.md", role: "主要角色档案、关系、动机、口头禅和成长曲线。", lifecycle: "reference" },
    { path: "素材.md", role: "题材所需的地点、行业、案例、对标桥段和可复用台词。", lifecycle: "reference" },
    { path: "正文/", role: "唯一成稿目录，按 NN-标题.md 命名，每章一个文件。", lifecycle: "final" },
    { path: ".work/", role: "临时大纲实验、被废弃的章节版本、试写片段和审校笔记。", lifecycle: "draft" },
  ],
  namingConventions: [
    { path: "正文/", pattern: "NN-标题.md，NN 是两位章节编号，标题取章节钩子。", example: "01-未婚夫和闺蜜在我葬礼上接吻.md" },
    { path: ".work/", pattern: "YYYYMMDD-目的.md，用于临时大纲、试写和审校笔记。", example: "20260514-反派人设试稿.md" },
  ],
  skillRouting: [],
  starterMessage: `## 这是什么

这是一个面向 5,000-40,000 字中文短篇/中篇网文的写作工作区，适合情感反转、复仇打脸、追妻火葬场、马甲爽文等强钩子题材。每个工作区只承载一本书。

## 我会怎么做

我会先在 简报.md 写清题材定位、主角设置、目标读者和核心钩子；然后在 大纲.md 列出分章节 beat；同时在 人物.md 立起角色，在 素材.md 收集所需素材。简报和大纲就绪后，我再把章节写进 正文/，每章一个 NN-标题.md。

## 流程

1. 在 简报.md 里写清题材定位、主角、目标读者、核心钩子与篇幅目标。
2. 在 大纲.md 里按章列出钩子、冲突、反转和情绪落点。
3. 同步充实 人物.md 与 素材.md，给正文留足支撑。
4. 进入 正文/，每章一个 NN-标题.md，章节标题就是钩子。
5. 修订靠 git diff 留痕，不另立 草稿/ 或 定稿/。

## 你现在可以提供

请告诉我题材方向（情感反转 / 复仇打脸 / 追妻火葬场 / 马甲爽文 / 其他）、主角设置（性别、身份、起点）、情绪基调、目标章节数与单章字数、不可触碰的禁区，以及若干你认可的对标作品或桥段。`,
};
