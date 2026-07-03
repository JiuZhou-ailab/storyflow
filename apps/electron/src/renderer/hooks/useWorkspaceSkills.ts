// input: Active workspace ID, optional session working directory, and Electron skills IPC API
// output: Workspace/project skills loaded with duplicate in-flight requests coalesced
// pos: Renderer loader boundary for AppShell skill state

import type { LoadedSkill } from '../../shared/types'

type WorkspaceSkillsApi = Pick<typeof window.electronAPI, 'getSkills'>

const skillsLoadCache = new Map<string, Promise<LoadedSkill[]>>()

function skillsLoadKey(workspaceId: string, workingDirectory?: string): string {
  return `${workspaceId}\n${workingDirectory ?? ''}`
}

export function __resetWorkspaceSkillsLoadCacheForTests(): void {
  skillsLoadCache.clear()
}

export function loadSkillsForWorkspace(
  workspaceId: string,
  workingDirectory?: string,
  api: WorkspaceSkillsApi = window.electronAPI,
): Promise<LoadedSkill[]> {
  const key = skillsLoadKey(workspaceId, workingDirectory)
  const existing = skillsLoadCache.get(key)
  if (existing) return existing

  const promise = api.getSkills(workspaceId, workingDirectory)
  skillsLoadCache.set(key, promise)
  const clearIfCurrent = () => {
    if (skillsLoadCache.get(key) === promise) {
      skillsLoadCache.delete(key)
    }
  }
  promise.then(clearIfCurrent, clearIfCurrent)

  return promise
}
