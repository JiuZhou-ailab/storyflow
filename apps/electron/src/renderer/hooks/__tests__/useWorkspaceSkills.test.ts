// input: Renderer runtime Skill loader and mocked Electron skills API
// output: Regression coverage for duplicate in-flight skills loads
// pos: Guards the AppShell Skill loading boundary

import { describe, expect, it } from 'bun:test'
import { __resetWorkspaceSkillsLoadCacheForTests, loadSkillsForWorkspace } from '../useWorkspaceSkills'
import type { LoadedSkill } from '../../../shared/types'

const skill: LoadedSkill = {
  slug: 'draft',
  metadata: { name: 'Draft', description: 'Draft prose' },
  content: 'Write a draft.',
  path: '/home/user/.pi/agent/skills/draft',
  filePath: '/home/user/.pi/agent/skills/draft/SKILL.md',
  scope: 'user',
  source: 'pi',
  origin: 'top-level',
}

describe('loadSkillsForWorkspace', () => {
  it('coalesces concurrent loads and clears the cache after completion', async () => {
    __resetWorkspaceSkillsLoadCacheForTests()

    let resolveSkills: (value: LoadedSkill[]) => void
    const skillsPromise = new Promise<LoadedSkill[]>((resolve) => {
      resolveSkills = resolve
    })

    let calls = 0
    const api = {
      getSkills: async () => {
        calls += 1
        return skillsPromise
      },
    }

    const first = loadSkillsForWorkspace('workspace-1', '/project-a', api)
    const second = loadSkillsForWorkspace('workspace-1', '/project-a', api)

    resolveSkills!([skill])
    expect(await Promise.all([first, second])).toEqual([
      [skill],
      [skill],
    ])
    expect(calls).toBe(1)

    await loadSkillsForWorkspace('workspace-1', '/project-a', {
      getSkills: async () => {
        calls += 1
        return []
      },
    })

    expect(calls).toBe(2)
  })

  it('does not coalesce different project catalogs in one workspace', async () => {
    __resetWorkspaceSkillsLoadCacheForTests()
    const calls: Array<string | undefined> = []
    const api = {
      getSkills: async (_workspaceId: string, cwd?: string) => {
        calls.push(cwd)
        return []
      },
    }

    await Promise.all([
      loadSkillsForWorkspace('workspace-1', '/project-a', api),
      loadSkillsForWorkspace('workspace-1', '/project-b', api),
    ])

    expect(calls).toEqual(['/project-a', '/project-b'])
  })
})
