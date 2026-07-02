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
    { path: "全局", kind: "directory" },
    { path: "全局/项目说明.md", kind: "file" },
    { path: "全局/创作要求.md", kind: "file" },
  ],
  requiredSkills: [],
  runtimePreamble: "",
  agentIdentity: "",
  defaultSkill: "",
  alwaysOnInstructions: "This is a free creation workspace. Do not impose a fixed planning taxonomy. Keep durable project facts and user-approved constraints under 全局/. Do not create prose, scratch, or reference roots unless the user explicitly asks for them.",
  initialRequestPolicy: "Respect the user's chosen workflow. If the request is broad, extract known intent and offer a small next artifact instead of forcing a large template.",
  artifactContract: [
    { path: "全局/项目说明.md", role: "Current project purpose, user intent, and lightweight notes.", lifecycle: "intake" },
    { path: "全局/创作要求.md", role: "Durable writing preferences and boundaries.", lifecycle: "canon" },
  ],
  namingConventions: [],
  operatingRules: undefined,
  skillRouting: [],
  starterMessage: `## 这是什么

这是自由创作工作区，适合用户已经有自己的写法，或者暂时不想被固定方法论约束的项目。

## 文件

- 全局/：项目事实、项目说明、创作要求和长期设定。

## 我会怎么做

我不强塞结构。会先尊重你的输入和现有文件，只在需要时把稳定事实写入全局，并用最小必要的简报、提纲或修订建议推进。

## 流程

1. 先接收你已有的想法、片段、素材或旧稿。
2. 判断当前只需要记录事实，还是需要补一个轻量项目说明。
3. 用最小必要产物推进，不预设复杂分类。
4. 只有当你认可某个稳定约定时，才写入项目说明或创作要求。

## 你现在可以提供

可以直接给想法、片段、素材、旧稿、标题、人物、世界观，或者只说你现在想写什么。`,
};
