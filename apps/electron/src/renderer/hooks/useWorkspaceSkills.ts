// input: Active Storyflow project ID and Electron skills IPC API
// output: Project-only Skills loaded with duplicate in-flight requests coalesced
// pos: Renderer loader boundary for AppShell skill state

import type { LoadedSkill } from '../../shared/types'

type WorkspaceSkillsApi = Pick<typeof window.electronAPI, 'getSkills'>

const skillsLoadCache = new Map<string, Promise<LoadedSkill[]>>()

export function __resetWorkspaceSkillsLoadCacheForTests(): void {
  skillsLoadCache.clear()
}

export function loadSkillsForWorkspace(
  workspaceId: string,
  api: WorkspaceSkillsApi = window.electronAPI,
): Promise<LoadedSkill[]> {
  const key = workspaceId
  const existing = skillsLoadCache.get(key)
  if (existing) return existing

  const promise = api.getSkills(workspaceId)
  skillsLoadCache.set(key, promise)
  const clearIfCurrent = () => {
    if (skillsLoadCache.get(key) === promise) {
      skillsLoadCache.delete(key)
    }
  }
  promise.then(clearIfCurrent, clearIfCurrent)

  return promise
}
