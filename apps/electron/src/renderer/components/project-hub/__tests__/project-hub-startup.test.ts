// input: Renderer App source
// output: Static regression checks for direct-project startup and rail-owned project management
// pos: Guards startup from reintroducing a duplicate full-page project gallery

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const rendererEntrySource = readFileSync(new URL('../../../main.tsx', import.meta.url), 'utf8')
const rendererHtmlSource = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../../../main/index.ts', import.meta.url), 'utf8')

describe('ProjectHub startup integration', () => {
  it('keeps the project catalog in the rail instead of a central manager surface', () => {
    expect(appSource).toContain("'project-hub'")
    expect(appSource).not.toContain('<ProjectManagerPanel')
    expect(appSource).toContain('selectStartupWorkspaceId')
    expect(appSource).toContain('从左侧展开项目并选择对话')
    expect(appSource).not.toMatch(/<ProjectHub[\s>]/)
  })

  it('does not keep the old post-login profile handoff page in the startup path', () => {
    expect(appSource).not.toContain("appState === 'profile'")
    expect(appSource).not.toContain('ClientProfilePage')
    expect(appSource).not.toContain('shouldShowClientProfile')
    expect(appSource).not.toContain('showProfile:')
  })

  it('opens project conversations through the explicit runtime switch path', () => {
    expect(appSource).toContain('handleSelectProjectSession')
    expect(appSource).toContain('activateRuntimeWorkspace(workspaceId, routes.view.allSessions(sessionId))')
    expect(appSource).not.toContain('handleOpenProjectFromHub')
    expect(appSource).not.toContain('ProjectHubPlaceholder')
  })

  it('can restore a prior room route after project creation / return', () => {
    expect(appSource).toContain('focusedPanelRouteAtom')
    expect(appSource).toContain('consumeReturnRoute(routes.view.writing())')
    expect(appSource).toContain('returnDestination')
  })

  it('keeps project-hub back shortcuts on the root action registry', () => {
    expect(appSource.match(/<ActionRegistryProvider>/g)).toHaveLength(1)
    expect(appSource).toContain('<ProjectHubNavigationActions onReturn={handleReturnToActiveProject} />')
  })

  it('shows the project shell before background workspace hydration completes', () => {
    const activationSource = appSource.slice(
      appSource.indexOf('const activateRuntimeWorkspace ='),
      appSource.indexOf('// Handle project selection.')
    )

    expect(activationSource.indexOf('setRuntimeWorkspace(nextWorkspace)')).toBeLessThan(
      activationSource.indexOf('window.electronAPI.switchWorkspace(workspaceId)')
    )
    expect(activationSource.indexOf('setWindowWorkspaceId(workspaceId)')).toBeLessThan(
      activationSource.indexOf('window.electronAPI.switchWorkspace(workspaceId)')
    )
    expect(activationSource).toContain("setAppState('ready')")
  })

  it('starts the Agent runtime from a real renderer-interactive signal', () => {
    expect(appSource).toContain('notifyShellInteractive?.()')
    expect(mainSource).toContain("ipcMain.once('renderer:shell-interactive'")
    expect(mainSource).not.toContain("firstWindow.once('ready-to-show'")
  })

  it('keeps the workspace and preview surfaces out of the project-hub static bundle', () => {
    expect(appSource).not.toContain("import { AppShell } from '@/components/app-shell/AppShell'")
    expect(appSource).toContain("import('@/components/workspace/WorkspaceSurface')")
    expect(appSource).toContain("import('@/components/file-preview/FilePreviewRenderer')")
    expect(appSource).toContain('const WorkspaceSurface = React.lazy(')
    expect(appSource).toContain('const FilePreviewRenderer = React.lazy(')
    expect(appSource).not.toContain('ImagePreviewOverlay,')
    expect(appSource).not.toContain('PDFPreviewOverlay,')
  })

  it('requires authentication before mounting the project shell', () => {
    expect(rendererEntrySource).toContain('ClientAuthBootstrap')
    expect(rendererEntrySource).toContain('getClientAuthState')
    expect(rendererEntrySource).toContain('state.required && !state.authenticated')
    expect(rendererEntrySource).toContain('<ClientAuthBootstrap>')
    expect(rendererEntrySource).toContain('<App />')
  })

  it('does not start automatic renderer monitoring', () => {
    expect(rendererEntrySource).not.toContain('@sentry/')
    expect(rendererEntrySource).not.toContain('initializeRendererMonitoring')
  })

  it('keeps locale payloads and external fonts off the startup critical path', () => {
    expect(rendererEntrySource).toContain("setupI18nLazy([LanguageDetector, initReactI18next])")
    expect(rendererEntrySource).toContain('runtimeI18n.resolvedLanguage')
    expect(rendererEntrySource).toContain('window.electronAPI?.changeLanguage')
    expect(rendererEntrySource).not.toContain("setupI18n([LanguageDetector, initReactI18next])")
    expect(rendererHtmlSource).not.toContain('fonts.googleapis.com')
    expect(rendererHtmlSource).not.toContain('fonts.gstatic.com')
  })

  it('keeps session hydration failures local instead of replacing the project shell', () => {
    expect(appSource).toContain('<SessionLoadErrorBanner')
    expect(appSource).not.toContain('<SessionLoadErrorScreen')
  })

  it('opens a new project in its starter conversation', () => {
    expect(appSource).toContain('handleSelectWorkspace(workspace.id)')
    expect(appSource).toContain('const session = await handleCreateSession(workspace.id)')
    expect(appSource).toContain('await handleSelectProjectSession(workspace.id, session.id)')
    expect(appSource).not.toContain('shouldOpenStarterSession')
  })

  it('keeps project create/import/remote in the rail creation entry', () => {
    expect(appSource).toContain('onWorkspaceCreated: (workspace: Workspace)')
    expect(appSource).toContain('handleProjectHubWorkspaceCreated')
    expect(appSource).toContain('onWorkspaceCreatedFromRail={projectManagerActions.onWorkspaceCreated}')
    expect(appSource).not.toContain('<ProjectManagerPanel')
    expect(appSource).not.toContain("openWorkspaceCreation('create')")
    expect(appSource).not.toContain("openWorkspaceCreation('open')")
    expect(appSource).not.toContain("openWorkspaceCreation('remote')")
  })
})
