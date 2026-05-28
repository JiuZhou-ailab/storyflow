// input: Electron user-data directory and the current packaged app version
// output: Launch-time auto-update decision plus persisted last-seen version marker
// pos: User-experience guard that prevents first launch from immediately downloading an update

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LaunchUpdateCheckDecision =
  | { shouldCheck: true }
  | { shouldCheck: false, reason: 'first-launch' | 'version-changed' | 'state-error' }

interface LaunchUpdateState {
  lastSeenVersion?: string
}

const STATE_FILE_NAME = 'update-launch-state.json'

function readLaunchUpdateState(path: string): LaunchUpdateState | null {
  if (!existsSync(path)) return null
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as LaunchUpdateState
  return parsed && typeof parsed === 'object' ? parsed : {}
}

function writeLaunchUpdateState(path: string, state: LaunchUpdateState): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
}

export function consumeLaunchUpdateCheckDecision(input: {
  userDataDir: string
  currentVersion: string
}): LaunchUpdateCheckDecision {
  const statePath = join(input.userDataDir, STATE_FILE_NAME)

  try {
    const state = readLaunchUpdateState(statePath)
    if (!state?.lastSeenVersion) {
      writeLaunchUpdateState(statePath, { lastSeenVersion: input.currentVersion })
      return { shouldCheck: false, reason: 'first-launch' }
    }

    if (state.lastSeenVersion !== input.currentVersion) {
      writeLaunchUpdateState(statePath, { lastSeenVersion: input.currentVersion })
      return { shouldCheck: false, reason: 'version-changed' }
    }

    return { shouldCheck: true }
  } catch {
    return { shouldCheck: false, reason: 'state-error' }
  }
}
