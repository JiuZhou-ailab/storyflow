// input: Built-in workspace creation method choices
// output: UI labels and createWorkspace options for each new workspace method
// pos: Single renderer-side contract between workspace creation UI and Method Pack scaffolding

import type { CreateWorkspaceOptions, WorkspaceProjectType } from "../../../shared/types"
import type { MethodPackId } from "@craft-agent/shared/writing/method-packs"

export type WorkspaceCreationMethodId = "general" | MethodPackId

export interface WorkspaceCreationMethodPreview {
  accent: "neutral" | "canon" | "market" | "structure" | "craft"
  thesis: string
  stages: Array<{
    label: string
    detail: string
  }>
  assets: string[]
  bestFor: string
}

export interface WorkspaceCreationMethodOption {
  id: WorkspaceCreationMethodId
  projectType: WorkspaceProjectType
  methodPackId?: MethodPackId
  previewKey: string
  titleKey: string
  subtitleKey: string
  previewMermaidKey: string
  previewDescriptionKey: string
  fallbackTitle: string
  fallbackSubtitle: string
  fallbackPreviewMermaid: string
  fallbackPreviewDescription: string
  richPreview: WorkspaceCreationMethodPreview
  richPreviewZh: WorkspaceCreationMethodPreview
}

export interface WorkspaceCreationRequestOptions extends CreateWorkspaceOptions {
  projectType: WorkspaceProjectType
}

export const WORKSPACE_CREATION_METHOD_OPTIONS = [
  {
    id: "general",
    projectType: "general",
    methodPackId: undefined,
    previewKey: "general",
    titleKey: "workspace.methodOptions.general.title",
    subtitleKey: "workspace.methodOptions.general.subtitle",
    previewMermaidKey: "workspace.methodOptions.general.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.general.previewDescription",
    fallbackTitle: "No Method Pack",
    fallbackSubtitle: "Plain workspace for coding, notes, or a custom structure.",
    fallbackPreviewMermaid: "flowchart TD\n  A[Empty workspace] --> B[Custom folders]\n  B --> C[Sources and skills]\n  C --> D[Project-specific workflow]",
    fallbackPreviewDescription: "Starts with a blank workspace and leaves structure, sources, skills, and workflow rules to the project.",
    richPreview: {
      accent: "neutral",
      thesis: "Blank canvas for projects that already have their own operating model.",
      stages: [
        { label: "Define", detail: "Bring your own folders, docs, and rules." },
        { label: "Connect", detail: "Attach sources, skills, and working context as needed." },
        { label: "Evolve", detail: "Let the workspace structure follow the project." },
      ],
      assets: ["Custom folders", "Project notes", "Sources", "Skills"],
      bestFor: "Coding, research, notes, or teams that do not want a writing scaffold.",
    },
    richPreviewZh: {
      accent: "neutral",
      thesis: "为空白项目保留最大自由度，适合已经有自己工作方式的团队。",
      stages: [
        { label: "定义", detail: "自行带入目录、文档和协作规则。" },
        { label: "连接", detail: "按需挂接 Sources、Skills 和工作上下文。" },
        { label: "演进", detail: "让 Workspace 结构随项目自然生长。" },
      ],
      assets: ["自定义目录", "项目笔记", "Sources", "Skills"],
      bestFor: "代码、研究、笔记，或不希望使用写作脚手架的项目。",
    },
  },
  {
    id: "novel.claude-book",
    projectType: "novel",
    methodPackId: "novel.claude-book",
    previewKey: "claudeBookNovel",
    titleKey: "workspace.methodOptions.claudeBookNovel.title",
    subtitleKey: "workspace.methodOptions.claudeBookNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.claudeBookNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.claudeBookNovel.previewDescription",
    fallbackTitle: "Claude-Book Method Pack",
    fallbackSubtitle: "Novel workspace with canon, state, timeline, and skills.",
    fallbackPreviewMermaid: "flowchart TD\n  A[Bible canon] --> B[Story plan]\n  B --> C[Chapter drafts]\n  C --> D[Current state]\n  D --> B\n  B --> E[Timeline]",
    fallbackPreviewDescription: "Best when the novel needs a durable bible, explicit continuity state, chapter planning, and timeline maintenance.",
    richPreview: {
      accent: "canon",
      thesis: "Canon-first long novel workflow with a stable project bible and continuity state.",
      stages: [
        { label: "Bible", detail: "World rules, characters, locations, style, and constraints." },
        { label: "Plan", detail: "Synopsis and chapter plan become the drafting contract." },
        { label: "Draft", detail: "Chapters are written against canon and plan." },
        { label: "Track", detail: "State and timeline update after each accepted chapter." },
      ],
      assets: ["bible/", "story/chapters/", "timeline/", "state/current/", "skills/"],
      bestFor: "Long-form novels where continuity, world state, and chapter-by-chapter control matter.",
    },
    richPreviewZh: {
      accent: "canon",
      thesis: "以 canon 为核心的长篇小说流程，用项目圣经和连续性状态压住全书一致性。",
      stages: [
        { label: "圣经", detail: "沉淀世界规则、角色、地点、文风和不可破坏约束。" },
        { label: "计划", detail: "用 synopsis 与章节计划形成写作契约。" },
        { label: "起草", detail: "每章都对齐 canon、计划和当前状态。" },
        { label: "追踪", detail: "接受章节后更新状态与时间线，反哺下一章。" },
      ],
      assets: ["bible/", "story/chapters/", "timeline/", "state/current/", "skills/"],
      bestFor: "需要稳定世界观、章节计划、连续性状态和时间线维护的长篇小说。",
    },
  },
  {
    id: "novel.oh-story",
    projectType: "novel",
    methodPackId: "novel.oh-story",
    previewKey: "ohStoryNovel",
    titleKey: "workspace.methodOptions.ohStoryNovel.title",
    subtitleKey: "workspace.methodOptions.ohStoryNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.ohStoryNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.ohStoryNovel.previewDescription",
    fallbackTitle: "Oh Story Web Fiction Pack",
    fallbackSubtitle: "Online-fiction workspace with settings, outline, manuscript, benchmarks, tracking, and cleanup skills.",
    fallbackPreviewMermaid: "flowchart TD\n  A[Market positioning] --> B[Settings]\n  B --> C[Outline]\n  C --> D[Manuscript]\n  D --> E[Tracking]\n  D --> F[Benchmark analysis]\n  F --> C",
    fallbackPreviewDescription: "Best for online fiction that needs positioning, benchmark analysis, update cadence, continuity tracking, and cleanup passes.",
    richPreview: {
      accent: "market",
      thesis: "Web-fiction workflow for hook, cadence, benchmark analysis, and serialized continuity.",
      stages: [
        { label: "Position", detail: "Genre lane, reader promise, hook, platform, and cadence." },
        { label: "Benchmark", detail: "Comparable works are broken down into reusable tactics." },
        { label: "Outline", detail: "Arcs and chapters optimize retention and forward pull." },
        { label: "Publish Loop", detail: "Draft, track foreshadowing, clean prose, repeat." },
      ],
      assets: ["设定/", "大纲/", "正文/", "对标/", "拆文库/", "追踪/"],
      bestFor: "Serialized online fiction that needs update rhythm, market fit, and chapter-level momentum.",
    },
    richPreviewZh: {
      accent: "market",
      thesis: "面向连载网文的节奏系统，围绕钩子、对标、更新频率和追读动能展开。",
      stages: [
        { label: "定位", detail: "明确题材赛道、读者承诺、核心钩子、平台与节奏。" },
        { label: "拆文", detail: "把对标作品拆成可复用的爽点、节奏和结构策略。" },
        { label: "铺排", detail: "用大纲和章节设计维持期待、反转和追读。" },
        { label: "连载", detail: "起草、追踪伏笔、清理 AI 味，再进入下一章。" },
      ],
      assets: ["设定/", "大纲/", "正文/", "对标/", "拆文库/", "追踪/"],
      bestFor: "需要市场定位、对标拆文、更新节奏和章节钩子的连载网文。",
    },
  },
  {
    id: "novel.crucible",
    projectType: "novel",
    methodPackId: "novel.crucible",
    previewKey: "crucibleNovel",
    titleKey: "workspace.methodOptions.crucibleNovel.title",
    subtitleKey: "workspace.methodOptions.crucibleNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.crucibleNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.crucibleNovel.previewDescription",
    fallbackTitle: "Crucible Structure Pack",
    fallbackSubtitle: "Epic-fantasy workspace with 36 beats, three strands, forge points, and review gates.",
    fallbackPreviewMermaid: "flowchart TD\n  A[Theme and burden] --> B[Three strands]\n  B --> C[36 beats]\n  C --> D[Forge points]\n  D --> E[Chapter outline]\n  E --> F[Draft and review]",
    fallbackPreviewDescription: "Best for structure-heavy long fiction, especially epic fantasy with three narrative strands and review gates.",
    richPreview: {
      accent: "structure",
      thesis: "High-structure planning system for pressure-driven fantasy and multi-strand stories.",
      stages: [
        { label: "Thesis", detail: "Theme, burden, antagonist mirror, and ending shape." },
        { label: "Strands", detail: "External quest, internal fire, and relationship pressure." },
        { label: "36 Beats", detail: "Beat grid and forge points turn pressure into structure." },
        { label: "Gate", detail: "Outline, draft, review, and revise through checkpoints." },
      ],
      assets: ["planning/", "outline/", "draft/chapters/", "draft/reviews/", ".crucible/state/"],
      bestFor: "Epic fantasy or structure-heavy long fiction that benefits from explicit beat governance.",
    },
    richPreviewZh: {
      accent: "structure",
      thesis: "高结构长篇系统，用三条叙事线、36 beats 和 forge points 管理故事压力。",
      stages: [
        { label: "命题", detail: "确定主题、主角负担、反派镜像和结局形状。" },
        { label: "三线", detail: "拆出外部任务、内部火焰和关系压力。" },
        { label: "36 Beats", detail: "用 beat 网格与 forge points 把压力落成结构。" },
        { label: "关卡", detail: "规划、章节大纲、起草、审校逐关推进。" },
      ],
      assets: ["planning/", "outline/", "draft/chapters/", "draft/reviews/", ".crucible/state/"],
      bestFor: "史诗奇幻或强结构长篇，尤其适合多线叙事和明确节拍治理。",
    },
  },
  {
    id: "novel.creative-writing",
    projectType: "novel",
    methodPackId: "novel.creative-writing",
    previewKey: "creativeWritingNovel",
    titleKey: "workspace.methodOptions.creativeWritingNovel.title",
    subtitleKey: "workspace.methodOptions.creativeWritingNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.creativeWritingNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.creativeWritingNovel.previewDescription",
    fallbackTitle: "Creative Writing Skills Pack",
    fallbackSubtitle: "General fiction workspace with kb, voice capture, drafting, critique, and revision loops.",
    fallbackPreviewMermaid: "flowchart TD\n  A[Knowledge base] --> B[Brainstorm]\n  B --> C[Outline]\n  C --> D[Draft]\n  D --> E[Critique]\n  E --> F[Revision]\n  F --> A",
    fallbackPreviewDescription: "Best when the workflow should stay flexible but still preserve canon, voice references, critique output, and revision loops.",
    richPreview: {
      accent: "craft",
      thesis: "Flexible craft lab for voice, knowledge capture, critique, and iterative revision.",
      stages: [
        { label: "Capture", detail: "Canon, references, voice notes, and style constraints." },
        { label: "Explore", detail: "Brainstorm scenes, arcs, premises, and alternatives." },
        { label: "Draft", detail: "Write with local knowledge and voice references nearby." },
        { label: "Revise", detail: "Critique, line edit, polish, and feed lessons back." },
      ],
      assets: ["kb/", "work/outlines/", "work/critiques/", "work/revisions/", "story/chapters/"],
      bestFor: "Flexible fiction projects that need strong craft support without a rigid beat system.",
    },
    richPreviewZh: {
      accent: "craft",
      thesis: "弹性的小说工坊，重点是知识沉淀、声线捕捉、批评反馈和反复修订。",
      stages: [
        { label: "捕捉", detail: "保存 canon、参考文本、声线笔记和风格约束。" },
        { label: "探索", detail: "自由生成场景、人物弧线、设定和方案分支。" },
        { label: "起草", detail: "带着本地知识库和声线参考写正文。" },
        { label: "修订", detail: "批评、行文修正、润色，并把经验回写知识库。" },
      ],
      assets: ["kb/", "work/outlines/", "work/critiques/", "work/revisions/", "story/chapters/"],
      bestFor: "不想被固定节拍束缚，但需要强写作技法支持和修订循环的小说项目。",
    },
  },
] as const satisfies readonly WorkspaceCreationMethodOption[]

export function getWorkspaceCreationMethodOption(methodId: WorkspaceCreationMethodId): WorkspaceCreationMethodOption {
  const option = WORKSPACE_CREATION_METHOD_OPTIONS.find(candidate => candidate.id === methodId)
  if (!option) {
    throw new Error(`Unknown workspace creation method: ${methodId}`)
  }

  return option
}

export function buildWorkspaceCreationOptions(methodId: WorkspaceCreationMethodId): WorkspaceCreationRequestOptions {
  const option = getWorkspaceCreationMethodOption(methodId)

  return {
    projectType: option.projectType,
    ...(option.methodPackId ? { methodPackId: option.methodPackId } : {}),
  }
}
