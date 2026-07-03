// input: Renderer workspace skill loader and mocked Electron skills API
// output: Regression coverage for duplicate in-flight skills loads
// pos: Guards the AppShell skills loading boundary used by project-scoped skills

import { describe, expect, it } from 'bun:test'
import { __resetWorkspaceSkillsLoadCacheForTests, loadSkillsForWorkspace } from '../useWorkspaceSkills'
import type { LoadedSkill } from '../../../shared/types'

const skill: LoadedSkill = {
  slug: 'draft',
  metadata: { name: 'Draft', description: 'Draft prose' },
  content: 'Write a draft.',
  path: '/project/.agents/skills/draft',
  source: 'project',
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

    const first = loadSkillsForWorkspace('workspace-1', '/project', api)
    const second = loadSkillsForWorkspace('workspace-1', '/project', api)

    resolveSkills!([skill])
    expect(await Promise.all([first, second])).toEqual([
      [skill],
      [skill],
    ])
    expect(calls).toBe(1)

    await loadSkillsForWorkspace('workspace-1', '/project', {
      getSkills: async () => {
        calls += 1
        return []
      },
    })

    expect(calls).toBe(2)
  })
})
