// input: Workspace git version history and restore/save callbacks
// output: Dialog for creating and restoring local writing snapshots
// pos: Writing workspace version-management control surface

import * as React from 'react'
import { GitCommitHorizontal, History, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { WorkspaceVersionEntry } from '../../../shared/types'

export interface NovelVersionHistoryDialogProps {
  open: boolean
  versions: WorkspaceVersionEntry[]
  loading?: boolean
  saving?: boolean
  restoringHash?: string | null
  onOpenChange: (open: boolean) => void
  onCreateVersion: () => void
  onRefresh: () => void
  onRestore: (hash: string) => void
}

export function NovelVersionHistoryDialog({
  open,
  versions,
  loading = false,
  saving = false,
  restoringHash = null,
  onOpenChange,
  onCreateVersion,
  onRefresh,
  onRestore,
}: NovelVersionHistoryDialogProps) {
  const { t } = useTranslation()
  const busy = loading || saving || !!restoringHash

  React.useEffect(() => {
    if (open) onRefresh()
  }, [onRefresh, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('writing.version.title', '版本管理')}
          </DialogTitle>
          <DialogDescription>
            {t('writing.version.description', '自动保存会在写作变更超过 100 字或间隔数分钟后创建本地版本。')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-[8px] border border-border/70 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-xs font-medium">{t('writing.version.manualSnapshot', '保存当前版本')}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {t('writing.version.manualSnapshotDescription', '会把当前写作工作区提交到本地 git 历史。')}
              </div>
            </div>
            <Button type="button" size="sm" disabled={busy} onClick={onCreateVersion}>
              <GitCommitHorizontal className="h-4 w-4" />
              {saving ? t('writing.version.saving', '保存中') : t('writing.version.save', '保存')}
            </Button>
          </div>

          <ScrollArea className="max-h-[320px] rounded-[8px] border border-border/70">
            <div className="divide-y divide-border/60">
              {loading ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {t('common.loading', '正在加载')}
                </div>
              ) : versions.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {t('writing.version.empty', '还没有保存过版本')}
                </div>
              ) : versions.map((version) => {
                const restoring = restoringHash === version.hash
                return (
                  <div key={version.hash} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{version.subject}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{formatVersionDate(version.timestamp)}</span>
                        <span>{version.hash.slice(0, 8)}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRestore(version.hash)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {restoring ? t('writing.version.restoring', '恢复中') : t('writing.version.restore', '恢复')}
                    </Button>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('common.close', '关闭')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatVersionDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
