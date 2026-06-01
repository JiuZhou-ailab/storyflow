// input: Renderer App source
// output: Static regression checks for ProjectHub startup integration
// pos: Guards project-first startup before workspace production UI

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')

describe('ProjectHub startup integration', () => {
  it('routes ordinary post-setup startup through the project hub', () => {
    expect(appSource).toContain("'project-hub'")
    expect(appSource).toContain('<ProjectHub')
    expect(appSource).toContain('buildProjectSummaries(workspaces)')
  })

  it('does not keep the old post-login profile handoff page in the startup path', () => {
    expect(appSource).not.toContain("appState === 'profile'")
    expect(appSource).not.toContain('ClientProfilePage')
    expect(appSource).not.toContain('shouldShowClientProfile')
    expect(appSource).not.toContain('showProfile:')
  })

  it('opens projects through the existing workspace switch path', () => {
    expect(appSource).toContain('handleOpenProjectFromHub')
    expect(appSource).toContain('handleSelectWorkspace(workspaceId)')
    expect(appSource).not.toContain('ProjectHubPlaceholder')
  })

  it('does not auto-open a starter chat session after creating or opening a project', () => {
    expect(appSource).toContain('handleSelectWorkspace(workspace.id)')
    expect(appSource).not.toContain('getAutoSessionIdForWorkspaceSwitch')
    expect(appSource).not.toContain('shouldOpenStarterSession')
  })

  it('allows returning from project creation when launched from an existing project hub', () => {
    expect(appSource).toContain('handleWorkspaceCreationClose')
    expect(appSource).toContain('canClose={true}')
    expect(appSource).toContain('closeLabel="返回项目中心"')
    expect(appSource).toContain("setAppState('project-hub')")
  })

  it('opens the creation flow at the step matching the selected project hub action', () => {
    expect(appSource).toContain("openWorkspaceCreation('create')")
    expect(appSource).toContain("openWorkspaceCreation('open')")
    expect(appSource).toContain("openWorkspaceCreation('remote')")
    expect(appSource).toContain('initialStep={workspaceCreationInitialStep}')
  })
})
