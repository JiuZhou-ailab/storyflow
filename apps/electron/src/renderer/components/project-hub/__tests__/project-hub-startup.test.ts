// input: Renderer App source
// output: Static regression checks for ProjectHub startup integration
// pos: Guards project-first startup before workspace production UI

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const rendererEntrySource = readFileSync(new URL('../../../main.tsx', import.meta.url), 'utf8')
const rendererHtmlSource = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../../../main/index.ts', import.meta.url), 'utf8')

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

  it('shows the project shell before background workspace hydration completes', () => {
    const openProjectSource = appSource.slice(
      appSource.indexOf('const handleOpenProjectFromHub ='),
      appSource.indexOf('const handleOpenProjectHub =')
    )

    expect(openProjectSource.indexOf("setAppState('ready')")).toBeLessThan(
      openProjectSource.indexOf('handleSelectWorkspace(workspaceId)')
    )
    expect(openProjectSource).not.toContain('await handleSelectWorkspace(workspaceId)')
    expect(openProjectSource).toContain('setPendingReadyRoute(routes.view.writing())')
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

  it('keeps the full client auth UI out of the ordinary startup bundle', () => {
    expect(rendererEntrySource).not.toContain("import { ClientAuthGate } from '@/components/auth/ClientAuthGate'")
    expect(rendererEntrySource).toContain("await import('@/components/auth/ClientAuthGate')")
    expect(rendererEntrySource).toContain('if (!state.required || state.authenticated) return <>{children}</>')
  })

  it('defers renderer monitoring until after the startup critical path', () => {
    expect(rendererEntrySource).not.toContain("import * as Sentry from '@sentry/react'")
    expect(rendererEntrySource).not.toContain("import { init as sentryInit } from '@sentry/electron/renderer'")
    expect(rendererEntrySource).toContain("import('@sentry/electron/renderer')")
    expect(rendererEntrySource).toContain('window.setTimeout(() => void initializeRendererMonitoring(), 3_000)')
  })

  it('keeps locale payloads and external fonts off the startup critical path', () => {
    expect(rendererEntrySource).toContain("setupI18nLazy([LanguageDetector, initReactI18next])")
    expect(rendererEntrySource).not.toContain("setupI18n([LanguageDetector, initReactI18next])")
    expect(rendererHtmlSource).not.toContain('fonts.googleapis.com')
    expect(rendererHtmlSource).not.toContain('fonts.gstatic.com')
  })

  it('keeps session hydration failures local instead of replacing the project shell', () => {
    expect(appSource).toContain('<SessionLoadErrorBanner')
    expect(appSource).not.toContain('<SessionLoadErrorScreen')
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
