// input: Active runtime routing ID, project cwd, and Electron skills IPC API
// output: Pi project catalog with duplicate in-flight requests coalesced
// pos: Renderer routing boundary for AppShell Skill state

import type { LoadedSkill } from '../../shared/types'

type WorkspaceSkillsApi = Pick<typeof window.electronAPI, 'getSkills'>

const skillsLoadCache = new Map<string, Promise<LoadedSkill[]>>()

export function __resetWorkspaceSkillsLoadCacheForTests(): void {
  skillsLoadCache.clear()
}

export function loadSkillsForWorkspace(
  workspaceId: string,
  workingDirectory?: string,
  api: WorkspaceSkillsApi = window.electronAPI,
): Promise<LoadedSkill[]> {
  const key = `${workspaceId}\0${workingDirectory ?? ''}`
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
