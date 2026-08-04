// input: Active runtime routing ID, project cwd, and Electron skills IPC API
// output: Event-invalidated Pi project catalog cache with duplicate requests coalesced
// pos: Renderer routing boundary for AppShell Skill state

import type { LoadedSkill } from '../../shared/types'

type WorkspaceSkillsApi = Pick<typeof window.electronAPI, 'getSkills'>

const skillsLoadCache = new Map<string, Promise<LoadedSkill[]>>()

export function __resetWorkspaceSkillsLoadCacheForTests(): void {
  skillsLoadCache.clear()
}

export function invalidateWorkspaceSkillsCache(workspaceId: string): void {
  const prefix = `${workspaceId}\0`
  for (const key of skillsLoadCache.keys()) {
    if (key.startsWith(prefix)) skillsLoadCache.delete(key)
  }
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
  promise.catch(() => {
    if (skillsLoadCache.get(key) === promise) {
      skillsLoadCache.delete(key)
    }
  })

  return promise
}
