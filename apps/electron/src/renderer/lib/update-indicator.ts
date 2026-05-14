// input: Electron auto-update snapshots exposed to the renderer
// output: Display state for the top-bar update affordance
// pos: Small presentation-state adapter between update IPC state and React UI

import type { UpdateInfo } from '../../shared/types'

export type UpdateIndicatorState = {
  kind: 'downloading' | 'ready' | 'installing'
  version: string | null
  progress: number
  actionable: boolean
}

export function getUpdateIndicatorState(info: UpdateInfo | null): UpdateIndicatorState | null {
  if (!info) return null

  if (info.downloadState === 'downloading') {
    return {
      kind: 'downloading',
      version: info.latestVersion,
      progress: clampProgress(info.downloadProgress),
      actionable: false,
    }
  }

  if (info.downloadState === 'ready') {
    return {
      kind: 'ready',
      version: info.latestVersion,
      progress: 100,
      actionable: true,
    }
  }

  if (info.downloadState === 'installing') {
    return {
      kind: 'installing',
      version: info.latestVersion,
      progress: 100,
      actionable: false,
    }
  }

  return null
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(100, Math.round(progress)))
}
