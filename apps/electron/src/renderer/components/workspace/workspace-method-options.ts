// input: Built-in workspace creation method choices
// output: UI labels and createWorkspace options for each new workspace method
// pos: Single renderer-side contract between workspace creation UI and Method Pack scaffolding

import type { CreateWorkspaceOptions, WorkspaceProjectType } from "../../../shared/types"
import type { MethodPackId } from "@craft-agent/shared/writing/method-packs"

export type WorkspaceCreationMethodId = "general" | MethodPackId

export interface WorkspaceCreationMethodOption {
  id: WorkspaceCreationMethodId
  projectType: WorkspaceProjectType
  methodPackId?: MethodPackId
  titleKey: string
  subtitleKey: string
  fallbackTitle: string
  fallbackSubtitle: string
}

export interface WorkspaceCreationRequestOptions extends CreateWorkspaceOptions {
  projectType: WorkspaceProjectType
}

export const WORKSPACE_CREATION_METHOD_OPTIONS = [
  {
    id: "general",
    projectType: "general",
    methodPackId: undefined,
    titleKey: "workspace.methodOptions.general.title",
    subtitleKey: "workspace.methodOptions.general.subtitle",
    fallbackTitle: "No Method Pack",
    fallbackSubtitle: "Plain workspace for coding, notes, or a custom structure.",
  },
  {
    id: "novel.claude-book",
    projectType: "novel",
    methodPackId: "novel.claude-book",
    titleKey: "workspace.methodOptions.claudeBookNovel.title",
    subtitleKey: "workspace.methodOptions.claudeBookNovel.subtitle",
    fallbackTitle: "Claude-Book Method Pack",
    fallbackSubtitle: "Novel workspace with canon, state, timeline, and skills.",
  },
] as const satisfies readonly WorkspaceCreationMethodOption[]

export function buildWorkspaceCreationOptions(methodId: WorkspaceCreationMethodId): WorkspaceCreationRequestOptions {
  const option = WORKSPACE_CREATION_METHOD_OPTIONS.find(candidate => candidate.id === methodId)
  if (!option) {
    throw new Error(`Unknown workspace creation method: ${methodId}`)
  }

  return {
    projectType: option.projectType,
    ...(option.methodPackId ? { methodPackId: option.methodPackId } : {}),
  }
}
