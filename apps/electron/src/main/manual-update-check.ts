// input: Auto-update snapshots returned after a manual update check
// output: Native dialog view models for completed manual checks
// pos: Main-process presentation adapter for macOS native update check feedback

import { i18n } from '@craft-agent/shared/i18n'
import type { UpdateInfo } from '../shared/types'

export interface ManualUpdateCheckDialog {
  type: 'info' | 'error'
  message: string
  detail?: string
}

function translate(key: string, fallback: string, values?: Record<string, string>): string {
  const translated = i18n.t(key, { ...values, defaultValue: fallback })
  return typeof translated === 'string' && translated.length > 0 ? translated : fallback
}

export function getManualUpdateCheckDialog(info: UpdateInfo): ManualUpdateCheckDialog | null {
  if (info.downloadState === 'error') {
    return {
      type: 'error',
      message: translate('toast.failedToCheckUpdates', 'Failed to check for updates'),
      detail: info.error,
    }
  }

  if (!info.available) {
    return {
      type: 'info',
      message: translate('toast.upToDate', "You're up to date"),
      detail: translate(
        'toast.versionIsLatest',
        `Version ${info.currentVersion} is the latest.`,
        { version: info.currentVersion },
      ),
    }
  }

  if (info.downloadState === 'ready' && info.latestVersion) {
    return {
      type: 'info',
      message: translate(
        'toast.updateReady',
        `Update v${info.latestVersion} ready`,
        { version: info.latestVersion },
      ),
      detail: translate('toast.restartToApply', 'Restart to apply the update.'),
    }
  }

  return null
}
