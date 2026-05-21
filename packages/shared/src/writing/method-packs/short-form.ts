// input: Short-form writing workflow contract
// output: Built-in Method Pack definition for 5,000-30,000 character web fiction projects
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
    { path: "创作要求.md", kind: "file" },
    { path: "简报.md", kind: "file" },
    { path: "大纲.md", kind: "file" },
    { path: "人物.md", kind: "file" },
    { path: "素材.md", kind: "file" },
    { path: "正文", kind: "directory" },
    { path: "自由区", kind: "directory" },
  ],
  requiredSkills: [
    "short-opening-designer",
    "short-golden-three",
    "short-draft-chapter",
    "short-reviser",
  ],
  runtimePreamble: "",
  agentIdentity: "",
  defaultSkill: "",
  alwaysOnInstructions: "",
  initialRequestPolicy: "",
  artifactContract: [
    { path: "创作要求.md", role: "长期偏好与禁区。", lifecycle: "canon" },
    { path: "简报.md", role: "当前作品 intake。", lifecycle: "intake" },
    { path: "大纲.md", role: "章节 outline。", lifecycle: "outline" },
    { path: "人物.md", role: "角色 reference。", lifecycle: "reference" },
    { path: "素材.md", role: "素材 reference。", lifecycle: "reference" },
    { path: "正文/", role: "Accepted prose。", lifecycle: "final" },
    { path: "自由区/", role: "Scratch。", lifecycle: "draft" },
  ],
  namingConventions: [
    { path: "正文/", pattern: "NN-标题.md，NN 是两位章节编号，标题取章节钩子。", example: "01-未婚夫和闺蜜在我葬礼上接吻.md" },
    { path: "自由区/", pattern: "YYYYMMDD-目的.md，用于临时大纲、试写和审校笔记。", example: "20260514-反派人设试稿.md" },
  ],
  operatingRules: undefined,
  skillRouting: [],
  starterMessage: `## 这是什么

这是一个面向 5,000-30,000 字中文短篇/中篇网文的写作工作区。系统会创建简报、大纲、人物、素材、正文和自由区，并安装短文写作 skills。

## 文件

- 创作要求.md：长期偏好与禁区。
- 简报.md：当前作品 intake。
- 大纲.md：章节 outline。
- 人物.md / 素材.md：reference。
- 正文/：accepted prose。
- 自由区/：scratch。

`,
};
