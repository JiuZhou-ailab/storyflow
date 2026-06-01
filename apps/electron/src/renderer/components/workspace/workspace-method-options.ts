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
  accent: "neutral" | "canon" | "structure" | "free"
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

const WORKSPACE_CREATION_METHOD_OPTIONS_INTERNAL = [
  {
    id: "novel.claude-book",
    projectType: "novel",
    methodPackId: "novel.claude-book",
    fileContract: getMethodPackFileContract("novel.claude-book"),
    previewKey: "longFormNovel",
    titleKey: "workspace.methodOptions.longFormNovel.title",
    subtitleKey: "workspace.methodOptions.longFormNovel.subtitle",
    previewMermaidKey: "workspace.methodOptions.longFormNovel.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.longFormNovel.previewDescription",
    fallbackTitle: "长文小说",
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
    id: "screenplay.logic",
    projectType: "screenplay",
    methodPackId: "screenplay.logic",
    fileContract: getMethodPackFileContract("screenplay.logic"),
    previewKey: "screenplayLogic",
    titleKey: "workspace.methodOptions.screenplayLogic.title",
    subtitleKey: "workspace.methodOptions.screenplayLogic.subtitle",
    previewMermaidKey: "workspace.methodOptions.screenplayLogic.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.screenplayLogic.previewDescription",
    fallbackTitle: "剧本逻辑",
    fallbackSubtitle: "用分场、行动线、因果链、冲突升级和对白功能管理剧本推进。",
    fallbackPreviewMermaid: "flowchart TD\n  A[故事梗概] --> B[主角目标]\n  A --> C[对抗力量]\n  B --> D[分场大纲]\n  C --> D\n  D --> E[场景目标]\n  E --> F[阻碍]\n  F --> G[转折]\n  G --> H[离场状态]\n  H --> I[因果链]\n  I --> J[冲突升级]\n  J --> K[对白草稿]\n  K --> L[逻辑审校]\n  L --> D",
    fallbackPreviewDescription: "适合剧本、短剧、分场故事和对白驱动项目，先把分场因果、冲突升级和对白功能成立，再进入正文。",
    richPreview: {
      accent: "structure",
      thesis: "剧本优先的逻辑系统，用分场、行动线、因果链和冲突升级管理每一场戏。",
      stages: [
        { label: "梗概", detail: "确认主角目标、对抗力量、结局承诺和序列形状。" },
        { label: "分场", detail: "每场写清入场状态、目标、阻碍、转折和离场状态。" },
        { label: "逻辑", detail: "用因果链和冲突升级检查场景连接。" },
        { label: "对白", detail: "场景目的成立后再写对白草稿。" },
      ],
      structure: [
        { label: "剧本层", items: ["故事梗概和分场大纲", "对白草稿服务场景功能"] },
        { label: "逻辑层", items: ["因果链检查场景连接", "冲突升级检查压力递进"] },
        { label: "参考层", items: ["人物表记录行动线与口吻", "场景表记录地点和限制"] },
      ],
      assets: ["剧本/", "角色/", "场景/", "逻辑/", "自由区/"],
      bestFor: "剧本、短剧、分场故事和对白驱动项目。",
    },
    richPreviewZh: {
      accent: "structure",
      thesis: "剧本优先的逻辑系统，用分场、行动线、因果链和冲突升级管理每一场戏。",
      stages: [
        { label: "梗概", detail: "确认主角目标、对抗力量、结局承诺和序列形状。" },
        { label: "分场", detail: "每场写清入场状态、目标、阻碍、转折和离场状态。" },
        { label: "逻辑", detail: "用因果链和冲突升级检查场景连接。" },
        { label: "对白", detail: "场景目的成立后再写对白草稿。" },
      ],
      structure: [
        { label: "剧本层", items: ["故事梗概和分场大纲", "对白草稿服务场景功能"] },
        { label: "逻辑层", items: ["因果链检查场景连接", "冲突升级检查压力递进"] },
        { label: "参考层", items: ["人物表记录行动线与口吻", "场景表记录地点和限制"] },
      ],
      assets: ["剧本/", "角色/", "场景/", "逻辑/", "自由区/"],
      bestFor: "剧本、短剧、分场故事和对白驱动项目。",
    },
  },
  {
    id: "novel.free-creation",
    projectType: "novel",
    methodPackId: "novel.free-creation",
    fileContract: getMethodPackFileContract("novel.free-creation"),
    previewKey: "freeCreation",
    titleKey: "workspace.methodOptions.freeCreation.title",
    subtitleKey: "workspace.methodOptions.freeCreation.subtitle",
    previewMermaidKey: "workspace.methodOptions.freeCreation.previewMermaid",
    previewDescriptionKey: "workspace.methodOptions.freeCreation.previewDescription",
    fallbackTitle: "自由创作",
    fallbackSubtitle: "不强塞结构，只保留项目说明、创作要求、正文、自由区和参考资料。",
    fallbackPreviewMermaid: "flowchart TD\n  A[用户输入] --> B[项目说明]\n  A --> C[创作要求]\n  B --> D[下一步]\n  C --> D\n  D --> E[正文]\n  D --> F[自由区]\n  D --> G[参考资料]\n  F --> H[试写]\n  F --> I[废弃版本]\n  G --> J[素材]\n  E --> K[接受内容]\n  H --> E\n  J --> B",
    fallbackPreviewDescription: "适合用户已经有自己的写法，或暂时不想被固定方法论约束的项目；不强塞结构，只保留最小归位。",
    richPreview: {
      accent: "free",
      thesis: "最轻量的自由创作入口，不强塞结构，只把接受稿、探索稿和参考资料分开。",
      stages: [
        { label: "接收", detail: "直接承接用户想法、片段、旧稿、素材或自由请求。" },
        { label: "归位", detail: "把接受内容、探索内容和参考资料放到不同位置。" },
        { label: "推进", detail: "只补当前任务需要的最小说明、提纲或修订建议。" },
        { label: "沉淀", detail: "用户认可后再把稳定约定写入项目说明或创作要求。" },
      ],
      structure: [
        { label: "自由层", items: ["项目说明.md 记录轻量约定", "自由区/ 承载试写和废弃版本"] },
        { label: "正文层", items: ["正文/ 存放已接受内容", "命名跟随用户自己的项目习惯"] },
        { label: "参考层", items: ["参考资料/ 保留素材来源", "创作要求.md 记录长期偏好"] },
      ],
      assets: ["项目说明.md", "创作要求.md", "正文/", "自由区/", "参考资料/"],
      bestFor: "已有自己写作流程，或希望先自由探索再逐步收敛的项目。",
    },
    richPreviewZh: {
      accent: "free",
      thesis: "最轻量的自由创作入口，不强塞结构，只把接受稿、探索稿和参考资料分开。",
      stages: [
        { label: "接收", detail: "直接承接用户想法、片段、旧稿、素材或自由请求。" },
        { label: "归位", detail: "把接受内容、探索内容和参考资料放到不同位置。" },
        { label: "推进", detail: "只补当前任务需要的最小说明、提纲或修订建议。" },
        { label: "沉淀", detail: "用户认可后再把稳定约定写入项目说明或创作要求。" },
      ],
      structure: [
        { label: "自由层", items: ["项目说明.md 记录轻量约定", "自由区/ 承载试写和废弃版本"] },
        { label: "正文层", items: ["正文/ 存放已接受内容", "命名跟随用户自己的项目习惯"] },
        { label: "参考层", items: ["参考资料/ 保留素材来源", "创作要求.md 记录长期偏好"] },
      ],
      assets: ["项目说明.md", "创作要求.md", "正文/", "自由区/", "参考资料/"],
      bestFor: "已有自己写作流程，或希望先自由探索再逐步收敛的项目。",
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
    fallbackSubtitle: "面向 5,000-30,000 字中文网文，一个工作区一本书，在简报里锁定黄金三章和密度选择，再靠大纲、人物撑住正文。",
    fallbackPreviewMermaid: "flowchart TD\n  A[初始请求] --> B[简报.md]\n  B --> B1[题材定位]\n  B --> B2[主角设置]\n  B --> B3[核心钩子]\n  B --> B4[黄金三章]\n  B --> B5[密度选择]\n  B4 --> C1[第1章拉新]\n  B4 --> C2[第2章加压]\n  B4 --> C3[第3章锁留存]\n  B5 --> D[大纲.md]\n  C3 --> D\n  D --> D1[分章 beat]\n  D --> E[人物.md]\n  D1 --> G[正文/NN-标题.md]\n  G --> H[git diff 留痕]\n  G --> I[自由区/ 试稿与审校]",
    fallbackPreviewDescription: "适合情感反转、复仇打脸、追妻火葬场、马甲爽文等强钩子中文网文，篇幅在 5,000-30,000 字之间，一个工作区只承载一本书，并在简报里把黄金三章、小说密度、事件密度和情绪调动程度作为正文前门禁。",
    richPreview: {
      accent: "neutral",
      thesis: "面向中文短篇/中篇网文的写作搭档，用 简报里的黄金三章和密度选择，加上 大纲 / 人物 撑住正文，每章一个 NN-标题.md。",
      stages: [
        { label: "定题", detail: "在 简报.md 写清题材定位、主角设置、核心钩子和篇幅目标。" },
        { label: "黄金三章", detail: "在 简报.md 设计第 1 章拉新、第 2 章加压、第 3 章锁留存。" },
        { label: "密度选择", detail: "在 简报.md 明确小说密度、事件密度和情绪调动程度。" },
        { label: "排章", detail: "在 大纲.md 按章列出钩子、冲突、反转和情绪落点。" },
        { label: "立人物", detail: "同步充实 人物.md，给正文留足角色动机、口吻和关系支撑。" },
        { label: "写章", detail: "每章一个 正文/NN-标题.md，章节标题就是钩子。" },
      ],
      structure: [
        { label: "长期约定", items: ["创作要求.md 长期写作风格", "禁区与个人偏好"] },
        { label: "当前作品", items: ["简报.md 当前作品的卖点", "简报.md 黄金三章与密度选择", "大纲.md / 人物.md"] },
        { label: "正文", items: ["正文/NN-标题.md 每章一个文件", "自由区/ 试稿与审校"] },
      ],
      assets: ["创作要求.md", "简报.md", "大纲.md", "人物.md", "正文/"],
      bestFor: "情感反转、复仇打脸、追妻火葬场、马甲爽文等中文短中篇网文。",
    },
    richPreviewZh: {
      accent: "neutral",
      thesis: "面向中文短篇/中篇网文的写作搭档，用 简报里的黄金三章和密度选择，加上 大纲 / 人物 撑住正文，每章一个 NN-标题.md。",
      stages: [
        { label: "定题", detail: "在 简报.md 写清题材定位、主角设置、核心钩子和篇幅目标。" },
        { label: "黄金三章", detail: "在 简报.md 设计第 1 章拉新、第 2 章加压、第 3 章锁留存。" },
        { label: "密度选择", detail: "在 简报.md 明确小说密度、事件密度和情绪调动程度。" },
        { label: "排章", detail: "在 大纲.md 按章列出钩子、冲突、反转和情绪落点。" },
        { label: "立人物", detail: "同步充实 人物.md，给正文留足角色动机、口吻和关系支撑。" },
        { label: "写章", detail: "每章一个 正文/NN-标题.md，章节标题就是钩子。" },
      ],
      structure: [
        { label: "长期约定", items: ["创作要求.md 长期写作风格", "禁区与个人偏好"] },
        { label: "当前作品", items: ["简报.md 当前作品的卖点", "简报.md 黄金三章与密度选择", "大纲.md / 人物.md"] },
        { label: "正文", items: ["正文/NN-标题.md 每章一个文件", "自由区/ 试稿与审校"] },
      ],
      assets: ["创作要求.md", "简报.md", "大纲.md", "人物.md", "正文/"],
      bestFor: "情感反转、复仇打脸、追妻火葬场、马甲爽文等中文短中篇网文。",
    },
  },
] as const satisfies readonly WorkspaceCreationMethodOption[]

export const WORKSPACE_CREATION_METHOD_OPTIONS = [
  ...WORKSPACE_CREATION_METHOD_OPTIONS_INTERNAL.filter(option => option.id === DEFAULT_WORKSPACE_CREATION_METHOD_ID),
  ...WORKSPACE_CREATION_METHOD_OPTIONS_INTERNAL.filter(option => option.id !== DEFAULT_WORKSPACE_CREATION_METHOD_ID),
] satisfies readonly WorkspaceCreationMethodOption[]

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
