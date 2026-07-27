// input: Bundled official Skill Creator, Storyflow runtime adapter, and renderer creation-entry source
// output: Contract checks for the full evaluation loop and global conversational creation
// pos: Prevents Add Skill from regressing to a shallow scaffold or foreign resource owner

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { validateSkillDocumentForSlug } from '@craft-agent/shared/skills'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf-8')
const skillsListSource = readFileSync(new URL('../SkillsListPanel.tsx', import.meta.url), 'utf-8')
const editPopoverSource = readFileSync(new URL('../../ui/EditPopover.tsx', import.meta.url), 'utf-8')
const electronMainSource = readFileSync(new URL('../../../../main/index.ts', import.meta.url), 'utf-8')
const headlessBootstrapSource = readFileSync(
  new URL('../../../../../../../packages/server-core/src/bootstrap/headless-start.ts', import.meta.url),
  'utf-8',
)
const serverBuildSource = readFileSync(
  new URL('../../../../../../../scripts/build-server.ts', import.meta.url),
  'utf-8',
)
const sessionToolDefsSource = readFileSync(
  new URL('../../../../../../../packages/session-tools-core/src/tool-defs.ts', import.meta.url),
  'utf-8',
)
const skillCreatorSource = readFileSync(
  new URL('../../../../../resources/agent-defaults/global-skills/skill-creator/SKILL.md', import.meta.url),
  'utf-8',
)
const storyflowRuntimeSource = readFileSync(
  new URL(
    '../../../../../resources/agent-defaults/global-skills/skill-creator/references/storyflow-runtime.md',
    import.meta.url,
  ),
  'utf-8',
)

describe('Skill Creator entry', () => {
  it('ships a valid Storyflow-native Skill Creator', () => {
    expect(validateSkillDocumentForSlug(skillCreatorSource, 'skill-creator')).toBeNull()
    expect(skillCreatorSource).toContain('references/storyflow-runtime.md')
    expect(skillCreatorSource).toContain('## Running and evaluating test cases')
    expect(skillCreatorSource).toContain('eval-viewer/generate_review.py')
    expect(skillCreatorSource).toContain('python -m scripts.run_loop')
    expect(storyflowRuntimeSource).toContain('skill_create')
    expect(storyflowRuntimeSource).toContain('skill_validate')
    expect(storyflowRuntimeSource).toContain('~/.craft-agent/skills/<slug>/')
    expect(storyflowRuntimeSource).toContain('Do not redirect Storyflow Skills into `.agents`, `.codex`, a project directory')
  })

  it('routes every project through one global Skill Creator flow', () => {
    expect(editPopoverSource).toContain('Use [skill:skill-creator] to design a new Skill through conversation.')
    expect(editPopoverSource).toContain('call skill_create')
    expect(editPopoverSource).not.toContain('<target_workspace_id>')
    expect(editPopoverSource).not.toContain("'add-global-skill'")
    expect(appShellSource).toContain('<AddSkillPopover')
    expect(skillsListSource).toContain("getEditConfig('add-skill', '~/.craft-agent')")
    expect(skillsListSource).toContain('conversationWorkspaceId={workspace.id}')
    expect(skillsListSource).toContain('workingDirectory="none"')
    expect(editPopoverSource).toContain('workspace/${encodeURIComponent(conversationWorkspaceId)}/action/new-session')
    expect(editPopoverSource).toContain("conversationWorkspaceId ? '&window=focused' : ''")
    expect(skillsListSource).toContain('<AddSkillPopover')
    expect(appShellSource).not.toContain('CreateSkillDialog')
    expect(appShellSource).not.toContain('direct scaffold, not AI chat')
  })

  it('seeds and packages the product Skill in desktop and headless runtimes', () => {
    expect(electronMainSource).toContain('seedDefaultAgentResources()')
    expect(headlessBootstrapSource).toContain('seedDefaultAgentResources()')
    expect(serverBuildSource).toContain("'agent-defaults', 'docs', 'themes'")
  })

  it('creates through the product-owned validated session tool', () => {
    expect(sessionToolDefsSource).toContain("{ name: 'skill_create'")
    expect(sessionToolDefsSource).toContain("safeMode: 'block'")
    expect(sessionToolDefsSource).toContain('Existing Skills are never overwritten')
  })
})
