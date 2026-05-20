// input: Session metadata returned after an in-window workspace switch
// output: Regression coverage for choosing the first openable session after switching workspaces
// pos: Guards workspace switch hydration against empty main-panel states

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Session } from '../../../shared/types'
import { getAutoSessionIdForWorkspaceSwitch } from '../workspace-switch'

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    workspaceName: overrides.workspaceName ?? 'Workspace',
    messages: [],
    lastMessageAt: overrides.lastMessageAt ?? 0,
    isProcessing: false,
    sessionFolderPath: '',
    supportsBranching: true,
    ...overrides,
  } as Session
}

describe('getAutoSessionIdForWorkspaceSwitch', () => {
  it('returns the newest visible session for the selected workspace', () => {
    expect(getAutoSessionIdForWorkspaceSwitch([
      session({ id: 'old', workspaceId: 'workspace-1', lastMessageAt: 10 }),
      session({ id: 'new', workspaceId: 'workspace-1', lastMessageAt: 20 }),
      session({ id: 'other', workspaceId: 'workspace-2', lastMessageAt: 30 }),
    ], 'workspace-1')).toBe('new')
  })

  it('skips hidden and archived sessions', () => {
    expect(getAutoSessionIdForWorkspaceSwitch([
      session({ id: 'hidden', hidden: true, lastMessageAt: 30 }),
      session({ id: 'archived', isArchived: true, lastMessageAt: 20 }),
      session({ id: 'visible', lastMessageAt: 10 }),
    ], 'workspace-1')).toBe('visible')
  })

  it('accepts the remote workspace id mapping when present', () => {
    expect(getAutoSessionIdForWorkspaceSwitch([
      session({ id: 'remote-session', workspaceId: 'remote-1', lastMessageAt: 10 }),
    ], 'local-1', 'remote-1')).toBe('remote-session')
  })
})

describe('workspace switch loading boundaries', () => {
  it('keeps startup-only data loads out of the workspace session reload effect', () => {
    const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')
    const startupEffectSource = appSource.slice(
      appSource.indexOf('// Load startup-global data when app is ready'),
      appSource.indexOf('// Load sessions for the active workspace')
    )
    const workspaceSessionEffectSource = appSource.slice(
      appSource.indexOf('// Load sessions for the active workspace'),
      appSource.indexOf('// Subscribe to theme change events')
    )

    expect(startupEffectSource).not.toContain('loadSessionsFromServer')
    expect(workspaceSessionEffectSource).toContain('void loadSessionsFromServer()')
    expect(workspaceSessionEffectSource).not.toContain('getWorkspaces()')
    expect(workspaceSessionEffectSource).not.toContain('getAllDrafts()')
    expect(workspaceSessionEffectSource).not.toContain('getAppTheme()')
  })

  it('switches the renderer shell to the target workspace before awaiting backend hydration', () => {
    const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')
    const switchHandlerSource = appSource.slice(
      appSource.indexOf('const handleSelectWorkspace ='),
      appSource.indexOf('// Handle workspace switch by slug')
    )
    const workspaceSessionEffectSource = appSource.slice(
      appSource.indexOf('// Load sessions for the active workspace'),
      appSource.indexOf('// Subscribe to theme change events')
    )

    expect(switchHandlerSource.indexOf('setWindowWorkspaceId(workspaceId)')).toBeLessThan(
      switchHandlerSource.indexOf('window.electronAPI.switchWorkspace(workspaceId)')
    )
    expect(switchHandlerSource).toContain('workspaceSwitchInFlightRef.current = workspaceId')
    expect(workspaceSessionEffectSource).toContain('workspaceSwitchInFlightRef.current === windowWorkspaceId')
  })

  it('does not block workspace readiness on per-session permission reconciliation', () => {
    const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')
    const loadSessionsSource = appSource.slice(
      appSource.indexOf('const loadSessionsFromServer ='),
      appSource.indexOf('const refreshSessionsMetadataAfterReconnect =')
    )

    expect(loadSessionsSource.indexOf('setSessionsLoaded(true)')).toBeLessThan(
      loadSessionsSource.indexOf('loadedSessions.map((s) => reconcilePermissionModeState(s.id))')
    )
    expect(loadSessionsSource).not.toContain('await Promise.allSettled(\n        loadedSessions.map((s) => reconcilePermissionModeState(s.id))')
  })

  it('does not leave the app loading forever when backend workspace switching fails', () => {
    const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')
    const switchHandlerSource = appSource.slice(
      appSource.indexOf('const handleSelectWorkspace ='),
      appSource.indexOf('// Handle workspace switch by slug')
    )

    expect(switchHandlerSource).toContain('catch (error)')
    expect(switchHandlerSource.indexOf('catch (error)')).toBeLessThan(
      switchHandlerSource.indexOf('finally')
    )
    expect(switchHandlerSource).toContain('setSessionsLoaded(true)')
    expect(switchHandlerSource).toContain('lastLoadedSessionsWorkspaceRef.current = workspaceId')
  })

  it('bounds startup and workspace switch RPC waits so loading flags cannot hang forever', () => {
    const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')

    expect(appSource).toContain('function withTimeout<T>')
    expect(appSource).toContain('STARTUP_RPC_TIMEOUT_MS')
    expect(appSource).toContain('SESSION_RPC_TIMEOUT_MS')
    expect(appSource).toContain('WORKSPACE_SWITCH_RPC_TIMEOUT_MS')
    expect(appSource).toContain("withTimeout(\n        window.electronAPI.getSessions()")
    expect(appSource).toContain("withTimeout(\n      window.electronAPI.getWorkspaces()")
    expect(appSource).toContain("withTimeout(\n          window.electronAPI.switchWorkspace(workspaceId)")
  })
})
