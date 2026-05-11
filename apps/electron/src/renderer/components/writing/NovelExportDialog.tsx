// input: Novel workspace files and export callback
// output: Dialog for choosing export sections and manuscript merge behavior
// pos: Writing workspace export control surface

import * as React from 'react'
import { Check, Download } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  NOVEL_EXPORT_SECTIONS,
  type NovelExportOptions,
  type NovelExportSection,
} from '@/lib/novel-export'
import { buildNovelWorkspaceTree, summarizeNovelSection, type NovelWorkspaceFile } from '@/lib/writing-workspace'

const SECTION_LABEL_KEYS: Record<NovelExportSection, `writing.export.sections.${NovelExportSection}`> = {
  manuscript: 'writing.export.sections.manuscript',
  outline: 'writing.export.sections.outline',
  characters: 'writing.export.sections.characters',
  locations: 'writing.export.sections.locations',
  style: 'writing.export.sections.style',
  timeline: 'writing.export.sections.timeline',
  state: 'writing.export.sections.state',
  analysis: 'writing.export.sections.analysis',
  work: 'writing.export.sections.work',
}

export interface NovelExportDialogProps {
  open: boolean
  files: NovelWorkspaceFile[]
  exporting?: boolean
  onOpenChange: (open: boolean) => void
  onExport: (options: NovelExportOptions) => void
}

export function NovelExportDialog({
  open,
  files,
  exporting = false,
  onOpenChange,
  onExport,
}: NovelExportDialogProps) {
  const { t } = useTranslation()
  const tree = React.useMemo(() => buildNovelWorkspaceTree(files), [files])
  const sectionCounts = React.useMemo(() => {
    return Object.fromEntries(
      NOVEL_EXPORT_SECTIONS.map((section) => [section, summarizeNovelSection(tree[section].files).count])
    ) as Record<NovelExportSection, number>
  }, [tree])
  const availableSections = React.useMemo(
    () => NOVEL_EXPORT_SECTIONS.filter(section => sectionCounts[section] > 0),
    [sectionCounts]
  )
  const [selectedSections, setSelectedSections] = React.useState<NovelExportSection[]>(availableSections)
  const [mergeManuscript, setMergeManuscript] = React.useState(true)

  React.useEffect(() => {
    if (!open) return
    setSelectedSections(availableSections)
    setMergeManuscript(true)
  }, [availableSections, open])

  const selectedSet = React.useMemo(() => new Set(selectedSections), [selectedSections])
  const canExport = selectedSections.length > 0 && !exporting

  const toggleSection = (section: NovelExportSection) => {
    if (sectionCounts[section] === 0 || exporting) return
    setSelectedSections((current) => {
      if (current.includes(section)) {
        return current.filter(item => item !== section)
      }
      return [...current, section]
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]" showCloseButton={!exporting}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            {t('writing.export.title', '导出写作工作区')}
          </DialogTitle>
          <DialogDescription>
            {t('writing.export.description', '选择要导出的项目内容。文件会写入当前工作区内的 exports 文件夹。')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {t('writing.export.content', '导出内容')}
            </div>
            <ScrollArea className="max-h-[292px] rounded-[8px] border border-border/70">
              <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
                {NOVEL_EXPORT_SECTIONS.map((section) => {
                  const count = sectionCounts[section]
                  const selected = selectedSet.has(section)
                  return (
                    <button
                      key={section}
                      type="button"
                      disabled={count === 0 || exporting}
                      onClick={() => toggleSection(section)}
                      className={cn(
                        'flex min-h-10 items-center gap-2 rounded-[6px] border px-2.5 py-2 text-left text-xs transition-colors',
                        selected
                          ? 'border-foreground/25 bg-foreground/[0.06]'
                          : 'border-transparent hover:bg-foreground/[0.04]',
                        (count === 0 || exporting) && 'cursor-not-allowed opacity-45 hover:bg-transparent'
                      )}
                    >
                      <span className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                        selected ? 'border-foreground bg-foreground text-background' : 'border-foreground/20'
                      )}>
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {t(SECTION_LABEL_KEYS[section], getSectionFallback(section))}
                      </span>
                      <span className="rounded-[4px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-[8px] border border-border/70 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-xs font-medium">{t('writing.export.mergeManuscript', '正文导出为一个文件')}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {t('writing.export.mergeManuscriptDescription', '开启后，章节会按目录顺序合并为 manuscript.md。')}
              </div>
            </div>
            <Switch
              checked={mergeManuscript}
              disabled={exporting || sectionCounts.manuscript === 0}
              onCheckedChange={setMergeManuscript}
              aria-label={t('writing.export.mergeManuscript', '正文导出为一个文件')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={exporting} onClick={() => onOpenChange(false)}>
            {t('common.cancel', '取消')}
          </Button>
          <Button
            type="button"
            disabled={!canExport}
            onClick={() => onExport({ sections: selectedSections, mergeManuscript })}
          >
            <Download className="h-4 w-4" />
            {exporting ? t('writing.export.exporting', '正在导出') : t('writing.export.action', '导出')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function getSectionFallback(section: NovelExportSection): string {
  const labels: Record<NovelExportSection, string> = {
    manuscript: '正文',
    outline: '大纲',
    characters: '角色',
    locations: '地点',
    style: '风格',
    timeline: '时间线',
    state: '状态',
    analysis: '分析',
    work: '工作',
  }

  return labels[section]
}
