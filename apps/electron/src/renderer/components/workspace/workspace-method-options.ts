// input: Built-in workspace creation method choices
// output: UI labels and createWorkspace options for each new workspace method
// pos: Single renderer-side contract between workspace creation UI and Method Pack scaffolding

import type { CreateWorkspaceOptions, WorkspaceProjectType } from "../../../shared/types"
import { slugify } from "../../lib/slugify"
import {
  getBuiltInMethodPack,
  type MethodPackId,
  type MethodPackRequiredPath,
} from "@craft-agent/shared/writing/method-packs"

export type WorkspaceCreationMethodId = MethodPackId
export type WorkspaceCreationLocationOption = "default" | "custom"
export const DEFAULT_WORKSPACE_CREATION_METHOD_ID = "short-form.article" satisfies WorkspaceCreationMethodId

export interface WorkspaceCreationMethodPreview {
  accent: "neutral" | "canon" | "market" | "structure" | "craft"
  thesis: string
  stages: Array<{
    label: string
    detail: string
  }>
  structure: Array<{
    label: string
    items: string[]
  }>
  assets: string[]
  bestFor: string
}

export interface WorkspaceCreationMethodOption {
  id: WorkspaceCreationMethodId
  projectType: WorkspaceProjectType
  methodPackId?: MethodPackId
  fileContract: MethodPackRequiredPath[]
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

function appendPathSegment(basePath: string, segment: string): string {
  const separator = basePath.includes("\\") ? "\\" : "/"
  const normalizedBase = basePath.replace(/[\\/]+$/g, "")
  const normalizedSegment = segment.replace(/^[\\/]+/g, "")
  return `${normalizedBase}${separator}${normalizedSegment}`
}

export function buildWorkspaceFolderPath(input: {
  homeDir: string
  name: string
  customPath: string | null
  locationOption: WorkspaceCreationLocationOption
}): string | null {
  const slug = slugify(input.name)
  if (!slug) return null

  const basePath = input.locationOption === "default"
    ? (input.homeDir ? appendPathSegment(appendPathSegment(input.homeDir, ".craft-agent"), "workspaces") : null)
    : input.customPath

  return basePath ? appendPathSegment(basePath, slug) : null
}

function getMethodPackFileContract(methodPackId?: MethodPackId): MethodPackRequiredPath[] {
  if (!methodPackId) return []
  const methodPack = getBuiltInMethodPack(methodPackId)
  if (!methodPack) {
    throw new Error(`Unknown Method Pack file contract: ${methodPackId}`)
  }

  return methodPack.requiredPaths
}

export const WORKSPACE_CREATION_METHOD_OPTIONS = [
  {
    id: "novel.claude-book",
    projectType: "novel",
    methodPackId: "novel.claude-book",
    fileContract: getMethodPackFileContract("novel.claude-book"),
    previewKey: "claudeBookNovel",
    titleKey: "workspace.methodOptions.claudeBookNovel.title",
    subtitleKey: "workspace.methodOptions.claudeBookNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.claudeBookNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.claudeBookNovel.previewDescription",
    fallbackTitle: "Claude-Book 小说法",
    fallbackSubtitle: "以项目圣经、章节计划、当前状态和时间线维护长篇一致性。",
    fallbackPreviewMermaid: "flowchart TD\n  A[项目圣经] --> A1[风格指南]\n  A --> A2[角色档案]\n  A --> A3[世界设定]\n  A1 --> B[故事梗概]\n  A2 --> B\n  A3 --> B\n  B --> C[章节计划]\n  C --> D[章节草稿]\n  D --> E[连续性检查]\n  E --> F[当前状态]\n  E --> G[时间线]\n  F --> C\n  G --> C\n  D --> H[写作技能]",
    fallbackPreviewDescription: "适合需要稳定世界观、章节计划、连续性状态和时间线维护的长篇小说。",
    richPreview: {
      accent: "canon",
      thesis: "以 canon 为核心的长篇小说流程，用项目圣经和连续性状态压住全书一致性。",
      stages: [
        { label: "圣经", detail: "沉淀世界规则、角色、地点、文风和不可破坏约束。" },
        { label: "计划", detail: "用 synopsis 与章节计划形成写作契约。" },
        { label: "起草", detail: "每章都对齐 canon、计划和当前状态。" },
        { label: "追踪", detail: "接受章节后更新状态与时间线，反哺下一章。" },
      ],
      structure: [
        { label: "Canon 层", items: ["用 bible 固化不可变世界事实", "角色、地点、文风和硬约束分开维护"] },
        { label: "规划层", items: ["synopsis 与章节计划形成写作契约", "时间线与连续性假设显式记录"] },
        { label: "状态层", items: ["current state 记录最新故事状态", "已接受章节反哺下一章起草"] },
      ],
      assets: ["bible/", "story/chapters/", "timeline/", "state/current/", "skills/"],
      bestFor: "需要稳定世界观、章节计划、连续性状态和时间线维护的长篇小说。",
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
      structure: [
        { label: "Canon 层", items: ["用 bible 固化不可变世界事实", "角色、地点、文风和硬约束分开维护"] },
        { label: "规划层", items: ["synopsis 与章节计划形成写作契约", "时间线与连续性假设显式记录"] },
        { label: "状态层", items: ["current state 记录最新故事状态", "已接受章节反哺下一章起草"] },
      ],
      assets: ["bible/", "story/chapters/", "timeline/", "state/current/", "skills/"],
      bestFor: "需要稳定世界观、章节计划、连续性状态和时间线维护的长篇小说。",
    },
  },
  {
    id: "novel.oh-story",
    projectType: "novel",
    methodPackId: "novel.oh-story",
    fileContract: getMethodPackFileContract("novel.oh-story"),
    previewKey: "ohStoryNovel",
    titleKey: "workspace.methodOptions.ohStoryNovel.title",
    subtitleKey: "workspace.methodOptions.ohStoryNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.ohStoryNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.ohStoryNovel.previewDescription",
    fallbackTitle: "Oh Story 网文连载法",
    fallbackSubtitle: "围绕题材定位、对标拆文、章节钩子、追读节奏和去 AI 味组织网文。",
    fallbackPreviewMermaid: "flowchart TD\n  A[题材定位] --> A1[平台节奏]\n  A --> A2[读者承诺]\n  A1 --> B[设定]\n  A2 --> B\n  B --> C[对标作品]\n  C --> D[拆文策略]\n  D --> E[卷章大纲]\n  E --> F[章节钩子]\n  F --> G[正文连载]\n  G --> H[伏笔追踪]\n  G --> I[去 AI 味清理]\n  H --> E\n  I --> G",
    fallbackPreviewDescription: "适合需要市场定位、对标拆文、更新节奏、连续性追踪和章节钩子的连载网文。",
    richPreview: {
      accent: "market",
      thesis: "面向连载网文的节奏系统，围绕钩子、对标、更新频率和追读动能展开。",
      stages: [
        { label: "定位", detail: "明确题材赛道、读者承诺、核心钩子、平台与节奏。" },
        { label: "拆文", detail: "把对标作品拆成可复用的爽点、节奏和结构策略。" },
        { label: "铺排", detail: "用大纲和章节设计维持期待、反转和追读。" },
        { label: "连载", detail: "起草、追踪伏笔、清理 AI 味，再进入下一章。" },
      ],
      structure: [
        { label: "市场层", items: ["题材赛道、读者承诺、平台节奏", "对标作品库与可复用爽点策略"] },
        { label: "连载层", items: ["卷/章大纲和章节钩子", "伏笔、兑现与追读动能追踪"] },
        { label: "清理层", items: ["去 AI 味与口语化修正", "每次更新前的章节抛光"] },
      ],
      assets: ["设定/", "大纲/", "正文/", "对标/", "拆文库/", "追踪/"],
      bestFor: "需要市场定位、对标拆文、更新节奏和章节钩子的连载网文。",
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
      structure: [
        { label: "市场层", items: ["题材赛道、读者承诺、平台节奏", "对标作品库与可复用爽点策略"] },
        { label: "连载层", items: ["卷/章大纲和章节钩子", "伏笔、兑现与追读动能追踪"] },
        { label: "清理层", items: ["去 AI 味与口语化修正", "每次更新前的章节抛光"] },
      ],
      assets: ["设定/", "大纲/", "正文/", "对标/", "拆文库/", "追踪/"],
      bestFor: "需要市场定位、对标拆文、更新节奏和章节钩子的连载网文。",
    },
  },
  {
    id: "novel.crucible",
    projectType: "novel",
    methodPackId: "novel.crucible",
    fileContract: getMethodPackFileContract("novel.crucible"),
    previewKey: "crucibleNovel",
    titleKey: "workspace.methodOptions.crucibleNovel.title",
    subtitleKey: "workspace.methodOptions.crucibleNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.crucibleNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.crucibleNovel.previewDescription",
    fallbackTitle: "Crucible 结构长篇法",
    fallbackSubtitle: "用三条叙事线、36 个 beats、forge points 和审校关卡管理强结构长篇。",
    fallbackPreviewMermaid: "flowchart TD\n  A[主题与主角负担] --> B[反派镜像]\n  B --> C[三条叙事线]\n  C --> C1[外部任务线]\n  C --> C2[内部火焰线]\n  C --> C3[关系压力线]\n  C1 --> D[36 个 Beats]\n  C2 --> D\n  C3 --> D\n  D --> E[Forge Points]\n  E --> F[章节大纲]\n  F --> G[章节草稿]\n  G --> H[审校关卡]\n  H --> E",
    fallbackPreviewDescription: "适合史诗奇幻或强结构长篇，尤其适合多线叙事、明确节拍治理和审校关卡。",
    richPreview: {
      accent: "structure",
      thesis: "高结构长篇系统，用三条叙事线、36 beats 和 forge points 管理故事压力。",
      stages: [
        { label: "命题", detail: "确定主题、主角负担、反派镜像和结局形状。" },
        { label: "三线", detail: "拆出外部任务、内部火焰和关系压力。" },
        { label: "36 Beats", detail: "用 beat 网格与 forge points 把压力落成结构。" },
        { label: "关卡", detail: "规划、章节大纲、起草、审校逐关推进。" },
      ],
      structure: [
        { label: "压力模型", items: ["主题、负担、反派镜像、结局压力", "外部任务、内部火焰、关系压力三线"] },
        { label: "节拍治理", items: ["36-beat 网格", "forge points 与检查标准"] },
        { label: "审校关卡", items: ["章节大纲先于起草", "草稿审校先于修订"] },
      ],
      assets: ["planning/", "outline/", "draft/chapters/", "draft/reviews/", ".crucible/state/"],
      bestFor: "史诗奇幻或强结构长篇，尤其适合多线叙事和明确节拍治理。",
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
      structure: [
        { label: "压力模型", items: ["主题、负担、反派镜像、结局压力", "外部任务、内部火焰、关系压力三线"] },
        { label: "节拍治理", items: ["36-beat 网格", "forge points 与检查标准"] },
        { label: "审校关卡", items: ["章节大纲先于起草", "草稿审校先于修订"] },
      ],
      assets: ["planning/", "outline/", "draft/chapters/", "draft/reviews/", ".crucible/state/"],
      bestFor: "史诗奇幻或强结构长篇，尤其适合多线叙事和明确节拍治理。",
    },
  },
  {
    id: "novel.creative-writing",
    projectType: "novel",
    methodPackId: "novel.creative-writing",
    fileContract: getMethodPackFileContract("novel.creative-writing"),
    previewKey: "creativeWritingNovel",
    titleKey: "workspace.methodOptions.creativeWritingNovel.title",
    subtitleKey: "workspace.methodOptions.creativeWritingNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.creativeWritingNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.creativeWritingNovel.previewDescription",
    fallbackTitle: "Creative Writing 技法工坊",
    fallbackSubtitle: "用知识库、声线捕捉、自由探索、批评反馈和修订循环支持弹性小说创作。",
    fallbackPreviewMermaid: "flowchart TD\n  A[知识库] --> A1[Canon 事实]\n  A --> A2[声线参考]\n  A --> A3[时间线]\n  A1 --> B[头脑风暴]\n  A2 --> B\n  A3 --> B\n  B --> C[大纲与场景实验]\n  C --> D[章节草稿]\n  D --> E[批评报告]\n  E --> F[行文修正]\n  F --> G[修订稿]\n  G --> A",
    fallbackPreviewDescription: "适合流程要保持弹性，但仍需要沉淀知识库、声线参考、批评报告和修订循环的小说项目。",
    richPreview: {
      accent: "craft",
      thesis: "弹性的小说工坊，重点是知识沉淀、声线捕捉、批评反馈和反复修订。",
      stages: [
        { label: "捕捉", detail: "保存 canon、参考文本、声线笔记和风格约束。" },
        { label: "探索", detail: "自由生成场景、人物弧线、设定和方案分支。" },
        { label: "起草", detail: "带着本地知识库和声线参考写正文。" },
        { label: "修订", detail: "批评、行文修正、润色，并把经验回写知识库。" },
      ],
      structure: [
        { label: "知识层", items: ["canon、参考摘录与约束", "声线样本和风格笔记"] },
        { label: "工坊层", items: ["大纲、场景实验和备选方案", "批评记录与修订计划"] },
        { label: "正文层", items: ["章节草稿", "行文修正和润色轮次"] },
      ],
      assets: ["kb/", "work/outlines/", "work/critiques/", "work/revisions/", "story/chapters/"],
      bestFor: "不想被固定节拍束缚，但需要强写作技法支持和修订循环的小说项目。",
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
      structure: [
        { label: "知识层", items: ["canon、参考摘录与约束", "声线样本和风格笔记"] },
        { label: "工坊层", items: ["大纲、场景实验和备选方案", "批评记录与修订计划"] },
        { label: "正文层", items: ["章节草稿", "行文修正和润色轮次"] },
      ],
      assets: ["kb/", "work/outlines/", "work/critiques/", "work/revisions/", "story/chapters/"],
      bestFor: "不想被固定节拍束缚，但需要强写作技法支持和修订循环的小说项目。",
    },
  },
  {
    id: "short-form.article",
    projectType: "short-form",
    methodPackId: "short-form.article",
    fileContract: getMethodPackFileContract("short-form.article"),
    previewKey: "shortFormArticle",
    titleKey: "workspace.methodOptions.shortFormArticle.title",
    subtitleKey: "workspace.methodOptions.shortFormArticle.subtitle",
    previewMermaidKey: "workspace.methodOptions.shortFormArticle.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.shortFormArticle.previewDescription",
    fallbackTitle: "短篇/中篇小说",
    fallbackSubtitle: "面向 5,000-30,000 字中文网文，一个工作区一本书，靠简报、大纲、人物、素材撑住正文。",
    fallbackPreviewMermaid: "flowchart TD\n  A[初始请求] --> B[简报.md]\n  B --> B1[题材定位]\n  B --> B2[主角设置]\n  B --> B3[核心钩子]\n  B3 --> C[大纲.md]\n  C --> C1[分章 beat]\n  C --> D[人物.md]\n  C --> E[素材.md]\n  C1 --> F[正文/NN-标题.md]\n  F --> G[git diff 留痕]\n  F --> H[.work/ 试稿与审校]",
    fallbackPreviewDescription: "适合情感反转、复仇打脸、追妻火葬场、马甲爽文等强钩子中文网文，篇幅在 5,000-30,000 字之间，一个工作区只承载一本书。",
    richPreview: {
      accent: "neutral",
      thesis: "面向中文短篇/中篇网文的写作搭档，用 简报 / 大纲 / 人物 / 素材 撑住正文，每章一个 NN-标题.md。",
      stages: [
        { label: "定题", detail: "在 简报.md 写清题材定位、主角设置、核心钩子和篇幅目标。" },
        { label: "排章", detail: "在 大纲.md 按章列出钩子、冲突、反转和情绪落点。" },
        { label: "立人立料", detail: "同步充实 人物.md 与 素材.md，给正文留足支撑。" },
        { label: "写章", detail: "每章一个 正文/NN-标题.md，章节标题就是钩子。" },
      ],
      structure: [
        { label: "长期约定", items: ["创作要求.md 长期写作风格", "禁区与个人偏好"] },
        { label: "当前作品", items: ["简报.md 当前作品的卖点", "大纲.md / 人物.md / 素材.md"] },
        { label: "正文", items: ["正文/NN-标题.md 每章一个文件", ".work/ 试稿与审校"] },
      ],
      assets: ["创作要求.md", "简报.md", "大纲.md", "人物.md", "素材.md", "正文/"],
      bestFor: "情感反转、复仇打脸、追妻火葬场、马甲爽文等中文短中篇网文。",
    },
    richPreviewZh: {
      accent: "neutral",
      thesis: "面向中文短篇/中篇网文的写作搭档，用 简报 / 大纲 / 人物 / 素材 撑住正文，每章一个 NN-标题.md。",
      stages: [
        { label: "定题", detail: "在 简报.md 写清题材定位、主角设置、核心钩子和篇幅目标。" },
        { label: "排章", detail: "在 大纲.md 按章列出钩子、冲突、反转和情绪落点。" },
        { label: "立人立料", detail: "同步充实 人物.md 与 素材.md，给正文留足支撑。" },
        { label: "写章", detail: "每章一个 正文/NN-标题.md，章节标题就是钩子。" },
      ],
      structure: [
        { label: "长期约定", items: ["创作要求.md 长期写作风格", "禁区与个人偏好"] },
        { label: "当前作品", items: ["简报.md 当前作品的卖点", "大纲.md / 人物.md / 素材.md"] },
        { label: "正文", items: ["正文/NN-标题.md 每章一个文件", ".work/ 试稿与审校"] },
      ],
      assets: ["创作要求.md", "简报.md", "大纲.md", "人物.md", "素材.md", "正文/"],
      bestFor: "情感反转、复仇打脸、追妻火葬场、马甲爽文等中文短中篇网文。",
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
