// input: Screenplay-first story structure contract
// output: Built-in Method Pack definition for script logic projects
// pos: Source-of-truth metadata for screenplay logic workspaces

import type { MethodPack } from "./types.ts";

export const SCREENPLAY_LOGIC_METHOD_PACK: MethodPack = {
  id: "screenplay.logic",
  version: 1,
  displayName: "剧本逻辑",
  projectType: "screenplay",
  storageProfile: "screenplay-logic-compatible",
  source: {
    name: "Storyflow screenplay logic template",
    url: "https://github.com/craft-agent/craft-agents-oss",
    license: "internal",
    inspectedCommit: "",
  },
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: "创作要求.md", kind: "file" },
    { path: "剧本/故事梗概.md", kind: "file" },
    { path: "剧本/分场大纲.md", kind: "file" },
    { path: "剧本/对白草稿", kind: "directory" },
    { path: "角色/人物表.md", kind: "file" },
    { path: "场景/场景表.md", kind: "file" },
    { path: "逻辑/因果链.md", kind: "file" },
    { path: "逻辑/冲突升级.md", kind: "file" },
    { path: "自由区", kind: "directory" },
  ],
  requiredSkills: [
    "script-logic-planner",
  ],
  runtimePreamble: "This project uses the screenplay.logic method pack. Use 剧本/ for synopsis, scene outline, and dialogue drafts; 角色/ and 场景/ for reference; 逻辑/ for causality and escalation checks; 自由区/ for scratch.",
  agentIdentity: "You are a screenplay logic editor who protects scene causality, character action lines, conflict escalation, dialogue function, and sequence-level payoff before drafting.",
  defaultSkill: "script-logic-planner",
  alwaysOnInstructions: "Treat 剧本/分场大纲.md as the scene contract, 逻辑/因果链.md as the causal truth source, 逻辑/冲突升级.md as the pressure ladder, 角色/人物表.md as character action-line reference, and 自由区/ as temporary exploration.",
  initialRequestPolicy: "Do not jump straight into full script pages from a broad premise. First establish protagonist objective, opposing force, sequence order, scene purpose, causal transitions, and dialogue function.",
  artifactContract: [
    { path: "创作要求.md", role: "Durable writing preferences and boundaries.", lifecycle: "canon" },
    { path: "剧本/故事梗概.md", role: "Accepted premise, ending promise, and sequence shape.", lifecycle: "outline" },
    { path: "剧本/分场大纲.md", role: "Scene-by-scene contract before dialogue drafting.", lifecycle: "outline" },
    { path: "剧本/对白草稿/", role: "Working dialogue pages and scene drafts.", lifecycle: "draft" },
    { path: "角色/人物表.md", role: "Character objectives, tactics, voice, and relationship pressure.", lifecycle: "reference" },
    { path: "场景/场景表.md", role: "Locations, time, scene function, and production constraints.", lifecycle: "reference" },
    { path: "逻辑/因果链.md", role: "Cause-effect chain across scenes.", lifecycle: "state" },
    { path: "逻辑/冲突升级.md", role: "Escalation ladder and payoff tracking.", lifecycle: "state" },
    { path: "自由区/", role: "Scratch ideas, discarded beats, and review notes.", lifecycle: "draft" },
  ],
  namingConventions: [
    { path: "剧本/对白草稿/", pattern: "NN-场景名.md，NN 是场次编号。", example: "03-雨夜摊牌.md" },
    { path: "自由区/", pattern: "YYYYMMDD-目的.md，用于临时场景、备选对白和逻辑审校。", example: "20260531-第二幕转折备选.md" },
  ],
  operatingRules: undefined,
  skillRouting: [
    { when: "premise needs a scene sequence or causal spine", skill: "script-logic-planner" },
    { when: "dialogue is requested before scene purpose is clear", skill: "script-logic-planner" },
  ],
  starterMessage: `## 这是什么

这是剧本逻辑工作区，适合把故事前提拆成分场、动作线、对白功能、冲突升级和因果链。

## 我会怎么做

我会先确认主角目标、对抗力量、场景顺序、每场的信息变化和情绪压力，再进入对白草稿。每场戏都必须推动行动、关系、信息或代价。

## 流程

1. 建立故事梗概和主角行动线。
2. 写出分场大纲，标记每场戏的目标、阻碍、转折和离场状态。
3. 检查因果链和冲突升级，避免场景只靠巧合串联。
4. 在场景目的成立后起草对白。

## 你现在可以提供

请提供题材、片长或集数、主角目标、核心对抗、结局方向、关键场景、对白风格，以及你最担心的逻辑问题。`,
};
