// input: Project files and an export callback
// output: Dialog for selecting concrete files or folders to export
// pos: Folder-first project export control surface

import * as React from 'react'
import { Check, Download, FileText, Folder, Minus } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import {
  getProjectExportDirectories,
  type ProjectExportOptions,
} from '@/lib/project-export'
import type { NovelWorkspaceFile } from '@/lib/writing-workspace'

interface ProjectExportRow {
  path: string
  type: 'directory' | 'file'
}

export interface ProjectExportDialogProps {
  open: boolean
  files: NovelWorkspaceFile[]
  exporting?: boolean
  onOpenChange: (open: boolean) => void
  onExport: (options: ProjectExportOptions) => void
}

export function ProjectExportDialog(props: ProjectExportDialogProps) {
  return props.open || props.exporting ? <ProjectExportDialogContent {...props} /> : null
}

function ProjectExportDialogContent({
  open,
  files,
  exporting = false,
  onOpenChange,
  onExport,
}: ProjectExportDialogProps) {
  const { t } = useTranslation()
  const rows = React.useMemo<ProjectExportRow[]>(() => [
    ...getProjectExportDirectories(files).map(path => ({ path, type: 'directory' as const })),
    ...files.map(file => ({ path: file.relativePath, type: 'file' as const })),
  ].sort((left, right) => (
    left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' })
    || (left.type === 'directory' ? -1 : 1)
  )), [files])
  const allFilePaths = React.useMemo(
    () => files.map(file => file.relativePath),
    [files],
  )
  const [selectedFilePaths, setSelectedFilePaths] = React.useState<string[]>(allFilePaths)

  React.useEffect(() => {
    if (open) setSelectedFilePaths(allFilePaths)
  }, [allFilePaths, open])

  const selectedSet = React.useMemo(() => new Set(selectedFilePaths), [selectedFilePaths])
  const getDescendantFilePaths = React.useCallback((row: ProjectExportRow) => (
    row.type === 'file'
      ? [row.path]
      : allFilePaths.filter(path => path.startsWith(`${row.path}/`))
  ), [allFilePaths])
  const toggleRow = (row: ProjectExportRow) => {
    if (exporting) return
    const descendantPaths = getDescendantFilePaths(row)
    const allSelected = descendantPaths.every(path => selectedSet.has(path))
    setSelectedFilePaths(current => {
      const next = new Set(current)
      for (const path of descendantPaths) {
        if (allSelected) next.delete(path)
        else next.add(path)
      }
      return allFilePaths.filter(path => next.has(path))
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={exporting}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            {t('writing.export.title', '导出项目')}
          </DialogTitle>
          <DialogDescription>
            {t('writing.export.description', '选择要导出的文件或文件夹。目录结构会原样保留。')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[360px] rounded-[8px] border border-border/70">
          <div className="space-y-0.5 p-2">
            {rows.map(row => {
              const descendantPaths = getDescendantFilePaths(row)
              const selectedCount = descendantPaths.filter(path => selectedSet.has(path)).length
              const selected = descendantPaths.length > 0 && selectedCount === descendantPaths.length
              const partial = selectedCount > 0 && !selected
              const depth = row.path.split('/').length - 1
              const label = row.path.split('/').pop() ?? row.path

              return (
                <button
                  key={`${row.type}:${row.path}`}
                  type="button"
                  disabled={descendantPaths.length === 0 || exporting}
                  onClick={() => toggleRow(row)}
                  className={cn(
                    'flex min-h-9 w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-xs transition-colors',
                    'hover:bg-foreground/[0.04]',
                    (descendantPaths.length === 0 || exporting) && 'cursor-not-allowed opacity-45',
                  )}
                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                >
                  <span className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                    (selected || partial)
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-foreground/20',
                  )}>
                    {partial ? <Minus className="h-3 w-3" /> : selected ? <Check className="h-3 w-3" /> : null}
                  </span>
                  {row.type === 'directory'
                    ? <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    : <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {row.type === 'directory' ? (
                    <span className="text-[11px] text-muted-foreground">{descendantPaths.length}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={exporting} onClick={() => onOpenChange(false)}>
            {t('common.cancel', '取消')}
          </Button>
          <Button
            type="button"
            disabled={selectedFilePaths.length === 0 || exporting}
            onClick={() => onExport({ selectedPaths: selectedFilePaths })}
          >
            <Download className="h-4 w-4" />
            {exporting ? t('writing.export.exporting', '正在导出') : t('writing.export.action', '导出')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
