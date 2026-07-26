// input: Bundled Storyflow Skill Creator plus renderer creation-entry source
// output: Contract checks for validated Skill content and scoped conversational creation
// pos: Prevents Add Skill from regressing to a fixed scaffold or Codex-owned resource

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

describe('Skill Creator entry', () => {
  it('ships a valid Storyflow-native Skill Creator', () => {
    expect(validateSkillDocumentForSlug(skillCreatorSource, 'skill-creator')).toBeNull()
    expect(skillCreatorSource).toContain('每次回复末尾维护一份简短草案')
    expect(skillCreatorSource).toContain('只有用户明确表示创建、确认或保存后')
    expect(skillCreatorSource).not.toContain('~/.codex/skills')
    expect(skillCreatorSource).toContain('不要创建 `agents/openai.yaml`')
    expect(skillCreatorSource).toContain('交给 `skill_create`')
  })

  it('routes project and global creation through the Skill Creator conversation', () => {
    expect(editPopoverSource).toContain('Use [skill:skill-creator] to design a new Skill through conversation.')
    expect(editPopoverSource).toContain('call skill_create')
    expect(editPopoverSource).toContain('<target_workspace_id>')
    expect(editPopoverSource).toContain("'add-global-skill'")
    expect(appShellSource).toContain('<AddSkillPopover')
    expect(skillsListSource).toContain("isProject ? 'add-skill' : 'add-global-skill'")
    expect(skillsListSource).toContain('conversationWorkspaceId={FREE_CONVERSATION_WORKSPACE_ID}')
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
