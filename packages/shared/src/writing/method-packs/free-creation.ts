// input: Minimal free-form creative workspace contract
// output: Built-in Method Pack definition for free creation projects
// pos: Lightweight Method Pack for users who do not want a preset structure

import type { MethodPack } from "./types.ts";

export const FREE_CREATION_METHOD_PACK: MethodPack = {
  id: "novel.free-creation",
  version: 1,
  displayName: "自由创作",
  projectType: "novel",
  storageProfile: "free-creation-compatible",
  source: {
    name: "Storyflow free creation template",
    url: "https://github.com/craft-agent/craft-agents-oss",
    license: "internal",
    inspectedCommit: "",
  },
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: "项目说明.md", kind: "file" },
    { path: "创作要求.md", kind: "file" },
    { path: "正文", kind: "directory" },
    { path: "自由区", kind: "directory" },
    { path: "参考资料", kind: "directory" },
  ],
  requiredSkills: [],
  runtimePreamble: "",
  agentIdentity: "",
  defaultSkill: "",
  alwaysOnInstructions: "This is a free creation workspace. Do not impose a fixed planning taxonomy. Keep accepted prose under 正文/, temporary exploration under 自由区/, and source material under 参考资料/.",
  initialRequestPolicy: "Respect the user's chosen workflow. If the request is broad, extract known intent and offer a small next artifact instead of forcing a large template.",
  artifactContract: [
    { path: "项目说明.md", role: "Current project purpose, user intent, and lightweight notes.", lifecycle: "intake" },
    { path: "创作要求.md", role: "Durable writing preferences and boundaries.", lifecycle: "canon" },
    { path: "正文/", role: "Accepted prose or final creative output.", lifecycle: "final" },
    { path: "自由区/", role: "Scratch ideas, experiments, outlines, and discarded versions.", lifecycle: "draft" },
    { path: "参考资料/", role: "Source material, examples, and research.", lifecycle: "reference" },
  ],
  namingConventions: [
    { path: "正文/", pattern: "按用户自己的项目习惯命名；没有习惯时使用 NN-标题.md。", example: "01-开场.md" },
    { path: "自由区/", pattern: "YYYYMMDD-目的.md，用于临时方案、试写和审校笔记。", example: "20260531-人物关系试写.md" },
  ],
  operatingRules: undefined,
  skillRouting: [],
  starterMessage: `## 这是什么

这是自由创作工作区，适合用户已经有自己的写法，或者暂时不想被固定方法论约束的项目。

## 文件

- 项目说明.md：当前项目目的、范围和临时约定。
- 创作要求.md：长期写作偏好与禁区。
- 正文/：accepted prose。
- 自由区/：scratch。
- 参考资料/：source material。

## 我会怎么做

我不强塞结构。会先尊重你的输入和现有文件，只在需要时把内容归位到正文、自由区或参考资料，并用最小必要的简报、提纲或修订建议推进。

## 流程

1. 先接收你已有的想法、片段、素材或旧稿。
2. 判断当前只需要正文、自由区记录、参考资料整理，还是轻量项目说明。
3. 用最小必要产物推进，不预设复杂分类。
4. 只有当你认可某个稳定约定时，才写入项目说明或创作要求。

## 你现在可以提供

可以直接给想法、片段、素材、旧稿、标题、人物、世界观，或者只说你现在想写什么。`,
};
