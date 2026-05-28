// input: Electron auto-update IPC state and renderer runtime environment
// output: React hook exposing update state, manual retry, scheduled checks, and install action
// pos: Renderer coordinator between updater IPC and update-related UI surfaces

/**
 * Update Checker Hook
 *
 * Manages auto-update state for the Electron app.
 * - Listens for update availability broadcasts from main process
 * - Tracks download progress
 * - Provides methods to check for updates and install
 * - Shows toast notification when update is ready
 * - Persistent dismissal across app restarts (per version)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UpdateInfo } from '../../shared/types'
import { shouldRunScheduledUpdateCheck } from '../lib/update-indicator'

interface UseUpdateCheckerResult {
  /** Current update info */
  updateInfo: UpdateInfo | null
  /** Whether an update is available */
  updateAvailable: boolean
  /** Whether update is currently downloading */
  isDownloading: boolean
  /** Whether update is ready to install */
  isReadyToInstall: boolean
  /** Download progress (0-100) */
  downloadProgress: number
  /** Check for updates manually */
  checkForUpdates: () => Promise<void>
  /** Install the downloaded update and restart */
  installUpdate: () => Promise<void>
}

// Toast ID for update notification (allows dismiss/update)
const UPDATE_TOAST_ID = 'update-available'
const SCHEDULED_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

async function canRunScheduledUpdateChecks(): Promise<boolean> {
  if (window.electronAPI.getRuntimeEnvironment() !== 'electron') {
    return false
  }

  try {
    return !(await window.electronAPI.isDebugMode())
  } catch (error) {
    console.error('[useUpdateChecker] Failed to read packaged state:', error)
    return false
  }
}

export function useUpdateChecker(): UseUpdateCheckerResult {
  const { t } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  // Track if we've shown the toast for this version to avoid duplicates
  const shownToastVersionRef = useRef<string | null>(null)
  const lastScheduledCheckAtRef = useRef<number | null>(null)
  const scheduledCheckInFlightRef = useRef(false)

  // Show toast notification when update is ready
  const showUpdateToast = useCallback((version: string, onInstall: () => void) => {
    // Don't show if already shown for this version in this session
    if (shownToastVersionRef.current === version) {
      return
    }
    shownToastVersionRef.current = version

    toast.info(t('toast.updateReady', { version }), {
      id: UPDATE_TOAST_ID,
      description: t('toast.restartToApply'),
      duration: 10000, // 10 seconds, then auto-dismiss
      action: {
        label: t('toast.restart'),
        onClick: onInstall,
      },
      onDismiss: () => {
        // Persist dismissal so we don't show again after app restart
        window.electronAPI.dismissUpdate(version)
      },
    })
  }, [t])

  // Install the update
  const installUpdate = useCallback(async () => {
    try {
      // Dismiss the update toast first
      toast.dismiss(UPDATE_TOAST_ID)
      toast.info(t('toast.installingUpdate'), {
        description: t('toast.appWillRestart'),
        duration: 5000,
      })
      await window.electronAPI.installUpdate()
    } catch (error) {
      console.error('[useUpdateChecker] Install failed:', error)
      toast.error(t('toast.failedToInstallUpdate'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [])

  const checkAndNotify = useCallback(async (info: UpdateInfo) => {
    if (!info.available || !info.latestVersion) return
    if (info.downloadState !== 'ready') return

    // Check if this version was dismissed
    const dismissedVersion = await window.electronAPI.getDismissedUpdateVersion()
    if (dismissedVersion === info.latestVersion) {
      return
    }

    // Show toast for ready update
    showUpdateToast(info.latestVersion, installUpdate)
  }, [showUpdateToast, installUpdate])

  // Load initial state and check if update ready
  useEffect(() => {
    // Get initial update info
    window.electronAPI.getUpdateInfo().then((info) => {
      setUpdateInfo(info)
      checkAndNotify(info)
    })

    // Subscribe to update availability changes
    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      checkAndNotify(info)
    })

    // Subscribe to download progress updates
    const cleanupProgress = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setUpdateInfo((prev) => prev ? { ...prev, downloadProgress: progress } : prev)
    })

    return () => {
      cleanupAvailable()
      cleanupProgress()
    }
  }, [checkAndNotify])

  const runScheduledUpdateCheck = useCallback(async () => {
    const now = Date.now()
    const isPackaged = await canRunScheduledUpdateChecks()

    if (!shouldRunScheduledUpdateCheck({
      now,
      lastCheckedAt: lastScheduledCheckAtRef.current,
      intervalMs: SCHEDULED_UPDATE_CHECK_INTERVAL_MS,
      isPackaged,
    })) {
      return
    }

    if (scheduledCheckInFlightRef.current) {
      return
    }

    lastScheduledCheckAtRef.current = now
    scheduledCheckInFlightRef.current = true

    try {
      const info = await window.electronAPI.checkForUpdates()
      setUpdateInfo(info)
      await checkAndNotify(info)
    } catch (error) {
      console.error('[useUpdateChecker] Scheduled check failed:', error)
    } finally {
      scheduledCheckInFlightRef.current = false
    }
  }, [checkAndNotify])

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleNextCheck = () => {
      timeoutId = setTimeout(() => {
        if (cancelled) return
        void runScheduledUpdateCheck().finally(() => {
          if (!cancelled) scheduleNextCheck()
        })
      }, SCHEDULED_UPDATE_CHECK_INTERVAL_MS)
    }

    void canRunScheduledUpdateChecks().then((canRun) => {
      if (!cancelled && canRun) {
        scheduleNextCheck()
      }
    })

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  }, [runScheduledUpdateCheck])

  // Check for updates manually
  const checkForUpdates = useCallback(async () => {
    try {
      const info = await window.electronAPI.checkForUpdates()
      setUpdateInfo(info)
      lastScheduledCheckAtRef.current = Date.now()

      if (info.downloadState === 'error') {
        toast.error(t('toast.failedToCheckUpdates'), {
          description: info.error ?? 'Unknown error',
        })
      } else if (!info.available) {
        toast.success(t('toast.upToDate'), {
          description: t('toast.versionIsLatest', { version: info.currentVersion }),
          duration: 3000,
        })
      } else if (info.downloadState === 'ready' && info.latestVersion) {
        // If already ready, show toast (clear any previous dismissal since user explicitly checked)
        shownToastVersionRef.current = null // Reset so toast can show again
        showUpdateToast(info.latestVersion, installUpdate)
      }
    } catch (error) {
      console.error('[useUpdateChecker] Check failed:', error)
      toast.error(t('toast.failedToCheckUpdates'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [showUpdateToast, installUpdate])

  return {
    updateInfo,
    updateAvailable: updateInfo?.available ?? false,
    isDownloading: updateInfo?.downloadState === 'downloading',
    isReadyToInstall: updateInfo?.downloadState === 'ready',
    downloadProgress: updateInfo?.downloadProgress ?? 0,
    checkForUpdates,
    installUpdate,
  }
}
