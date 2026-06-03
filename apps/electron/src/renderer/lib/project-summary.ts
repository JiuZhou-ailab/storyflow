// input: Workspace metadata already available in renderer state
// output: ProjectHub v1 project summaries
// pos: Pure adapter between Workspace records and ProjectHub data

import type { MethodPackId } from '@craft-agent/shared/writing/method-packs'
import type { Workspace } from '../../shared/types'

export type ProjectStatus = 'local' | 'remote' | 'offline' | 'missing'
export type ProjectKind = 'novel' | 'screenplay' | 'short-form' | 'general'

export interface ProjectSummary {
  id: string
  name: string
  rootPath?: string
  kind: ProjectKind
  methodPackId?: MethodPackId
  status: ProjectStatus
  lastActivityAt?: number
}

type WorkspaceProjectMetadata = Workspace & {
  projectType?: unknown
  methodPackId?: unknown
  lastActivityAt?: unknown
}

function resolveProjectKind(projectType: unknown): ProjectKind {
  return projectType === 'novel' || projectType === 'screenplay' || projectType === 'short-form'
    ? projectType
    : 'general'
}

function resolveMethodPackId(methodPackId: unknown): MethodPackId | undefined {
  return typeof methodPackId === 'string' ? methodPackId as MethodPackId : undefined
}

function resolveLastActivityAt(workspace: WorkspaceProjectMetadata): number | undefined {
  if (typeof workspace.lastActivityAt === 'number') return workspace.lastActivityAt
  return typeof workspace.lastAccessedAt === 'number' ? workspace.lastAccessedAt : undefined
}

export function buildProjectSummaries(workspaces: Workspace[]): ProjectSummary[] {
  return workspaces.map((workspace) => {
    const metadata = workspace as WorkspaceProjectMetadata
    const methodPackId = resolveMethodPackId(metadata.methodPackId)
    const lastActivityAt = resolveLastActivityAt(metadata)
    const summary: ProjectSummary = {
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      kind: resolveProjectKind(metadata.projectType),
      status: workspace.remoteServer ? 'remote' : 'local',
    }

    if (methodPackId) {
      summary.methodPackId = methodPackId
    }
    if (lastActivityAt !== undefined) {
      summary.lastActivityAt = lastActivityAt
    }

    return summary
  })
}
