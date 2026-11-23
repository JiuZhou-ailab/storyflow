// input: Explicit mode choices, Host config directory, and registered Session identity
// output: Durable default for new conversations and per-Session execute consent
// pos: Host-owned trust boundary for permission mode restoration

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PermissionMode } from '@craft-agent/shared/agent'
import { CONFIG_DIR, type Workspace } from '@craft-agent/shared/config'
import { atomicWriteFileSync, readJsonFileSync } from '@craft-agent/shared/utils'
import { getSessionLog } from './session-runtime'

type SessionIdentity = { id: string; createdAt?: number }

interface ModePreferences {
  lastSelectedMode?: PermissionMode
  executeGrants: Record<string, true>
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'safe' || value === 'ask' || value === 'allow-all'
}

function grantKey(workspace: Workspace, session: SessionIdentity): string {
  return JSON.stringify([workspace.id, workspace.rootPath, session.id, session.createdAt])
}

export class PermissionModePreferences {
  private state?: ModePreferences

  constructor(private readonly configDir = CONFIG_DIR) {}

  private load(): ModePreferences {
    if (this.state) return this.state
    try {
      const stored = readJsonFileSync<Partial<ModePreferences> | null>(join(this.configDir, 'session-permission-modes.json'))
      const mode = stored?.lastSelectedMode
      this.state = {
        lastSelectedMode: isPermissionMode(mode) ? mode : undefined,
        executeGrants: stored?.executeGrants ?? {},
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        getSessionLog().warn('Failed to load saved session permission modes', error)
      }
      this.state = { executeGrants: {} }
    }
    return this.state
  }

  get lastSelectedMode(): PermissionMode | undefined {
    return this.load().lastSelectedMode
  }

  hasExecuteGrant(workspace: Workspace, session: SessionIdentity): boolean {
    return this.load().executeGrants[grantKey(workspace, session)] === true
  }

  save(workspace: Workspace, session: SessionIdentity, mode: PermissionMode, selectDefault = false): void {
    const current = this.load()
    const key = grantKey(workspace, session)
    const granting = mode === 'allow-all'
    const lastSelectedMode = selectDefault ? mode : current.lastSelectedMode
    if (granting === (current.executeGrants[key] === true) && lastSelectedMode === current.lastSelectedMode) {
      return
    }

    const executeGrants = { ...current.executeGrants }
    if (granting) executeGrants[key] = true
    else delete executeGrants[key]

    const next = { lastSelectedMode, executeGrants }
    mkdirSync(this.configDir, { recursive: true })
    atomicWriteFileSync(join(this.configDir, 'session-permission-modes.json'), JSON.stringify(next), { mode: 0o600 })
    this.state = next
  }
}
