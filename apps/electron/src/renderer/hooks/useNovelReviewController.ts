// input: Workspace-scoped reviewable novel file changes and selected manuscript path
// output: Novel review status and pending changes for the selected manuscript
// pos: Renderer hook owning the first extracted slice of AppShell novel review workflow state

import * as React from 'react'
import type { FileChange } from '@craft-agent/ui'
import * as storage from '@/lib/local-storage'
import {
  getPendingChangesForFile,
  parseNovelReviewStatusMap,
  type NovelReviewStatusMap,
} from '@/lib/novel-review-workflow'

export interface UseNovelReviewControllerOptions {
  novelWorkspaceRoot: string | null | undefined
  reviewableNovelFileChanges: FileChange[]
  selectedNovelFilePath: string | null | undefined
}

export interface UseNovelReviewControllerResult {
  novelChangeReviewStatus: NovelReviewStatusMap
  persistNovelChangeReviewStatus: (nextStatus: NovelReviewStatusMap) => void
  selectedNovelPendingChanges: FileChange[]
}

export function useNovelReviewController({
  novelWorkspaceRoot,
  reviewableNovelFileChanges,
  selectedNovelFilePath,
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

  const selectedNovelPendingChanges = React.useMemo(
    () => getPendingChangesForFile(reviewableNovelFileChanges, novelChangeReviewStatus, selectedNovelFilePath),
    [reviewableNovelFileChanges, novelChangeReviewStatus, selectedNovelFilePath]
  )

  return React.useMemo(() => ({
    novelChangeReviewStatus,
    persistNovelChangeReviewStatus,
    selectedNovelPendingChanges,
  }), [
    novelChangeReviewStatus,
    persistNovelChangeReviewStatus,
    selectedNovelPendingChanges,
  ])
}
