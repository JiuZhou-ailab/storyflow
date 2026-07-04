/**
 * Session Options Types
 *
 * Type definitions and helpers for session-scoped settings.
 * The actual hook is in AppShellContext.tsx as useSessionOptionsFor().
 *
 * ADDING A NEW SESSION OPTION:
 * 1. Add field to SessionOptions interface below
 * 2. Update defaultSessionOptions
 * 3. Add UI control in FreeFormInput.tsx (or wherever needed)
 */

import type { PermissionMode } from '../../shared/types'
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { DEFAULT_THINKING_LEVEL } from '@craft-agent/shared/agent/thinking-levels'
import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'

/**
 * All session-scoped options in one place.
 */
export interface SessionOptions {
  /** Permission mode ('safe', 'ask', 'allow-all') */
  permissionMode: PermissionMode
  /** Monotonic version from backend permission mode state (used to ignore stale events) */
  permissionModeVersion?: number
  /** Session-level thinking level — sticky, persisted. See {@link ThinkingLevel}. */
  thinkingLevel: ThinkingLevel
}

/** Default values for new sessions */
export const defaultSessionOptions: SessionOptions = {
  permissionMode: 'ask', // Default to ask mode (prompt for permissions)
  thinkingLevel: DEFAULT_THINKING_LEVEL, // Default to 'medium' level
}

export const sessionOptionsAtom = atom<Map<string, SessionOptions>>(new Map())

export const sessionOptionsAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => get(sessionOptionsAtom).get(sessionId) ?? defaultSessionOptions)
)

/** Type for partial updates to session options */
export type SessionOptionUpdates = Partial<SessionOptions>

/** Helper to merge session options with updates */
export function mergeSessionOptions(
  current: SessionOptions | undefined,
  updates: SessionOptionUpdates
): SessionOptions {
  return {
    ...defaultSessionOptions,
    ...current,
    ...updates,
  }
}

function isDefaultStoredSessionOptions(options: SessionOptions): boolean {
  return options.permissionMode === defaultSessionOptions.permissionMode
    && options.thinkingLevel === defaultSessionOptions.thinkingLevel
    && options.permissionModeVersion == null
}

function areSessionOptionsEqual(a: SessionOptions, b: SessionOptions): boolean {
  return a.permissionMode === b.permissionMode
    && a.thinkingLevel === b.thinkingLevel
    && a.permissionModeVersion === b.permissionModeVersion
}

export function updateSessionOptionsMap(
  options: Map<string, SessionOptions>,
  sessionId: string,
  updates: SessionOptionUpdates
): Map<string, SessionOptions> {
  const current = options.get(sessionId)
  const nextOptions = mergeSessionOptions(current, updates)

  if (isDefaultStoredSessionOptions(nextOptions)) {
    if (!current) return options
    const next = new Map(options)
    next.delete(sessionId)
    return next
  }

  if (current && areSessionOptionsEqual(current, nextOptions)) return options

  const next = new Map(options)
  next.set(sessionId, nextOptions)
  return next
}
