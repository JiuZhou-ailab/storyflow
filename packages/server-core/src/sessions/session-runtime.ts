// input: Host platform services and runtime hooks injected once at boot via setSessionPlatform/setSessionRuntimeHooks
// output: Process-wide accessors for the session logger, platform services, runtime hooks, and shared pure helpers
// pos: Singleton layer beneath the SessionManager facade; every extracted session module reads host context here

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { createScopedLogger, CONSOLE_LOGGER, type PlatformServices, type Logger } from '@craft-agent/server-core/runtime'
import type { Workspace } from '@craft-agent/shared/config'
import { isFreeConversationWorkspaceId } from '@craft-agent/shared/workspaces'
import type { BackendHostRuntimeContext } from '@craft-agent/shared/agent/backend'
import type { ManagedModelAccess } from '@craft-agent/shared/agent/backend/types'
import type { Message } from '@craft-agent/core/types'
import { MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE } from './managed-gateway-auth-error'

// Module-level platform ref — set once during init via setSessionPlatform()
let _platform: PlatformServices | null = null

// Scoped logger — upgraded from console fallback when setSessionPlatform() is called.
let sessionLog: Logger = createScopedLogger(CONSOLE_LOGGER, 'session')

export function getSessionLog(): Logger {
  return sessionLog
}

export function setSessionPlatform(platform: PlatformServices): void {
  _platform = platform
  sessionLog = createScopedLogger(platform.logger, 'session')
}

/** Host platform services, or null before setSessionPlatform() has run. */
export function getSessionPlatform(): PlatformServices | null {
  return _platform
}

export interface SessionRuntimeHooks {
  updateBadgeCount: (count: number) => void
  captureException: (error: unknown, context?: { errorSource?: string; sessionId?: string }) => void
  onSessionStarted: () => void
  onSessionStopped: () => void
  ensureManagedModelAccessToken: (
    forceRefresh?: boolean,
  ) => Promise<ManagedModelAccess & { refreshed: boolean }>
  /**
   * Resolves once the environment agent subprocesses inherit (notably PATH) is
   * ready. Hosts that must discover a login shell start that work at boot and
   * await it here, so session discovery is not serialized behind it.
   */
  whenSubprocessEnvReady: () => Promise<void>
}

const defaultSessionRuntimeHooks: SessionRuntimeHooks = {
  updateBadgeCount: () => {},
  onSessionStarted: () => {},
  onSessionStopped: () => {},
  ensureManagedModelAccessToken: async () => {
    throw new Error(MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE)
  },
  whenSubprocessEnvReady: async () => {},
  captureException: (error, context) => {
    const err = error instanceof Error ? error : new Error(String(error))
    if (_platform?.captureError) {
      _platform.captureError(err)
      return
    }
    sessionLog.error('[runtime-hooks] captureException fallback:', {
      errorSource: context?.errorSource,
      sessionId: context?.sessionId,
      message: err.message,
      stack: err.stack,
    })
  },
}

let sessionRuntimeHooks: SessionRuntimeHooks = defaultSessionRuntimeHooks

export function setSessionRuntimeHooks(hooks: Partial<SessionRuntimeHooks>): void {
  sessionRuntimeHooks = {
    ...sessionRuntimeHooks,
    ...hooks,
  }
}

export function getSessionRuntimeHooks(): SessionRuntimeHooks {
  return sessionRuntimeHooks
}

export function buildBackendHostRuntimeContext(): BackendHostRuntimeContext {
  if (!_platform) throw new Error('setSessionPlatform() must be called before session creation')
  return {
    appRootPath: _platform.appRootPath,
    resourcesPath: _platform.resourcesPath,
    isPackaged: _platform.isPackaged,
  }
}

/**
 * Project root used to load workspace resources (sources, skills). Free
 * Conversations have no project directory — resources come from app defaults.
 */
export function getResourceProjectRoot(workspace: Workspace): string | undefined {
  return isFreeConversationWorkspaceId(workspace.id)
    ? undefined
    : workspace.rootPath
}

/** True when a persisted Pi transcript already exists for the session path. */
export function hasPersistedPiTranscript(sessionPath: string): boolean {
  const piSessionsPath = join(sessionPath, '.pi-sessions')
  if (!existsSync(piSessionsPath)) return false
  try {
    return readdirSync(piSessionsPath, { withFileTypes: true })
      .some(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
  } catch {
    return false
  }
}

/** Get the last user-visible final output message id, including plan-only turns. */
export function getLastFinalOutputMessageId(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if ((msg.role === 'assistant' && !msg.isIntermediate) || msg.role === 'plan') {
      return msg.id
    }
  }
  return undefined
}
