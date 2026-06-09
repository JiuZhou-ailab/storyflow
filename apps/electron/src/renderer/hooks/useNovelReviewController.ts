// input: Workspace-scoped reviewable novel file changes and selected-file navigation callbacks
// output: Novel review status, pending review projections, and changed-file navigation handlers
// pos: Renderer hook owning the first extracted slice of AppShell novel review workflow state

import * as React from 'react'
import type { FileChange } from '@craft-agent/ui'
import * as storage from '@/lib/local-storage'
import {
  getAdjacentChangedFilePath,
  getPendingChangedFilePaths,
  getPendingChangesForFile,
  parseNovelReviewStatusMap,
  type NovelReviewStatusMap,
} from '@/lib/novel-review-workflow'

export type NovelReviewNavigationDirection = 'next' | 'previous'

export interface UseNovelReviewControllerOptions {
  novelWorkspaceRoot: string | null | undefined
  reviewableNovelFileChanges: FileChange[]
  selectedNovelFilePath: string | null | undefined
  onSelectNovelFileByPath: (filePath: string | null) => Promise<void> | void
}

export interface UseNovelReviewControllerResult {
  novelChangeReviewStatus: NovelReviewStatusMap
  persistNovelChangeReviewStatus: (nextStatus: NovelReviewStatusMap) => void
  pendingNovelChangedFilePaths: string[]
  selectedNovelPendingChanges: FileChange[]
  selectedNovelReviewFileIndex: number
  handleSelectAdjacentNovelChangeFile: (direction: NovelReviewNavigationDirection) => Promise<void>
  handleSelectNextNovelChangeAfterStatus: (filePath: string, nextStatus: NovelReviewStatusMap) => Promise<void>
}

export function useNovelReviewController({
  novelWorkspaceRoot,
  reviewableNovelFileChanges,
  selectedNovelFilePath,
  onSelectNovelFileByPath,
}: UseNovelReviewControllerOptions): UseNovelReviewControllerResult {
  const [novelChangeReviewStatus, setNovelChangeReviewStatus] = React.useState<NovelReviewStatusMap>({})

  React.useEffect(() => {
    if (!novelWorkspaceRoot) {
      setNovelChangeReviewStatus({})
      return
    }

    const saved = storage.get<Record<string, unknown>>(storage.KEYS.novelChangeReviewStatus, {}, novelWorkspaceRoot)
    setNovelChangeReviewStatus(parseNovelReviewStatusMap(saved))
  }, [novelWorkspaceRoot])

  React.useEffect(() => {
    if (!novelWorkspaceRoot || reviewableNovelFileChanges.length === 0) return

    setNovelChangeReviewStatus((current) => {
      const nextStatus = parseNovelReviewStatusMap(current, reviewableNovelFileChanges)
      storage.set(storage.KEYS.novelChangeReviewStatus, nextStatus, novelWorkspaceRoot)
      return nextStatus
    })
  }, [novelWorkspaceRoot, reviewableNovelFileChanges])

  const persistNovelChangeReviewStatus = React.useCallback((nextStatus: NovelReviewStatusMap) => {
    const normalizedStatus = parseNovelReviewStatusMap(nextStatus, reviewableNovelFileChanges)
    setNovelChangeReviewStatus(normalizedStatus)
    if (novelWorkspaceRoot) {
      storage.set(storage.KEYS.novelChangeReviewStatus, normalizedStatus, novelWorkspaceRoot)
    }
  }, [novelWorkspaceRoot, reviewableNovelFileChanges])

  const pendingNovelChangedFilePaths = React.useMemo(
    () => getPendingChangedFilePaths(reviewableNovelFileChanges, novelChangeReviewStatus),
    [reviewableNovelFileChanges, novelChangeReviewStatus]
  )

  const selectedNovelPendingChanges = React.useMemo(
    () => getPendingChangesForFile(reviewableNovelFileChanges, novelChangeReviewStatus, selectedNovelFilePath),
    [reviewableNovelFileChanges, novelChangeReviewStatus, selectedNovelFilePath]
  )

  const selectedNovelReviewFileIndex = React.useMemo(
    () => selectedNovelFilePath ? pendingNovelChangedFilePaths.indexOf(selectedNovelFilePath) : -1,
    [pendingNovelChangedFilePaths, selectedNovelFilePath]
  )

  const handleSelectAdjacentNovelChangeFile = React.useCallback(async (direction: NovelReviewNavigationDirection) => {
    const targetPath = getAdjacentChangedFilePath(
      pendingNovelChangedFilePaths,
      selectedNovelFilePath,
      direction
    )
    await onSelectNovelFileByPath(targetPath)
  }, [onSelectNovelFileByPath, pendingNovelChangedFilePaths, selectedNovelFilePath])

  const handleSelectNextNovelChangeAfterStatus = React.useCallback(async (
    filePath: string,
    nextStatus: NovelReviewStatusMap
  ) => {
    const nextPendingPaths = getPendingChangedFilePaths(reviewableNovelFileChanges, nextStatus)
    if (nextPendingPaths.length === 0) return

    const currentIndex = pendingNovelChangedFilePaths.indexOf(filePath)
    const searchOrder = currentIndex >= 0
      ? [
          ...pendingNovelChangedFilePaths.slice(currentIndex + 1),
          ...pendingNovelChangedFilePaths.slice(0, currentIndex + 1),
        ]
      : nextPendingPaths
    const targetPath = searchOrder.find(path => nextPendingPaths.includes(path)) ?? nextPendingPaths[0]
    await onSelectNovelFileByPath(targetPath)
  }, [onSelectNovelFileByPath, pendingNovelChangedFilePaths, reviewableNovelFileChanges])

  return React.useMemo(() => ({
    novelChangeReviewStatus,
    persistNovelChangeReviewStatus,
    pendingNovelChangedFilePaths,
    selectedNovelPendingChanges,
    selectedNovelReviewFileIndex,
    handleSelectAdjacentNovelChangeFile,
    handleSelectNextNovelChangeAfterStatus,
  }), [
    handleSelectAdjacentNovelChangeFile,
    handleSelectNextNovelChangeAfterStatus,
    novelChangeReviewStatus,
    pendingNovelChangedFilePaths,
    persistNovelChangeReviewStatus,
    selectedNovelPendingChanges,
    selectedNovelReviewFileIndex,
  ])
}
