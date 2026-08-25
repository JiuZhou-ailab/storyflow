// input: Active runtime routing ID, project cwd, and Electron skills IPC API
// output: Event-invalidated Pi project catalog cache with duplicate requests coalesced
// pos: Renderer routing boundary for AppShell Skill state

import type { LoadedSkill } from '../../shared/types'

type WorkspaceSkillsApi = Pick<typeof window.electronAPI, 'getSkills'>

const skillsLoadCache = new Map<string, Promise<LoadedSkill[]>>()
const skillsCacheVersions = new Map<string, number>()

export function __resetWorkspaceSkillsLoadCacheForTests(): void {
  skillsLoadCache.clear()
  skillsCacheVersions.clear()
}

export function invalidateWorkspaceSkillsCache(workspaceId: string): void {
  skillsCacheVersions.set(workspaceId, (skillsCacheVersions.get(workspaceId) ?? 0) + 1)
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

  const version = skillsCacheVersions.get(workspaceId) ?? 0
  const promise = api.getSkills(workspaceId, workingDirectory).then((skills) => {
    if ((skillsCacheVersions.get(workspaceId) ?? 0) !== version) {
      return loadSkillsForWorkspace(workspaceId, workingDirectory, api)
    }
    return skills
  })
  skillsLoadCache.set(key, promise)
  promise.catch(() => {
    if (skillsLoadCache.get(key) === promise) {
      skillsLoadCache.delete(key)
    }
  })

  return promise
}
