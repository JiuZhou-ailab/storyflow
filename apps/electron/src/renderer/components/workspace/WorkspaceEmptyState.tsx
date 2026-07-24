// input: Valid project identity, root path, and existing workspace actions
// output: Actionable cold-start surface for a project with no selected file
// pos: First-class empty workspace between the project tree and chat

import { FilePlus, FileUp, FolderOpen, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface WorkspaceEmptyStateProps {
  workspaceName: string
  rootPath: string
  onCreateFile: () => void
  onImportFiles: () => void
  onOpenSkills: () => void
}

export function WorkspaceEmptyState({
  workspaceName,
  rootPath,
  onCreateFile,
  onImportFiles,
  onOpenSkills,
}: WorkspaceEmptyStateProps) {
  const { t } = useTranslation()

  return (
    <section
      data-testid="workspace-empty-state"
      className="flex h-full min-w-0 flex-col bg-background"
      aria-label={workspaceName}
    >
      <header className="flex h-10 shrink-0 items-center border-b border-border/50 px-3">
        <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {workspaceName}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-8">
        <div className="flex w-full max-w-[280px] flex-col items-center text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-foreground/[0.04] text-muted-foreground/80">
            <FolderOpen className="size-5" strokeWidth={1.5} />
          </div>
          <h2 className="mt-4 text-sm font-medium text-foreground">
            {t('chatOpening.project.emptyTitle')}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('chatOpening.project.emptyHint')}
          </p>

          <div className="mt-5 flex w-full flex-col gap-2">
            <Button
              type="button"
              data-workspace-action="create-file"
              className="w-full"
              onClick={onCreateFile}
            >
              <FilePlus />
              {t('chatOpening.project.createFile.label')}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-workspace-action="import-files"
              className="w-full"
              onClick={onImportFiles}
            >
              <FileUp />
              {t('chatOpening.project.import.label')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-workspace-action="open-skills"
              className="w-full text-muted-foreground"
              onClick={onOpenSkills}
            >
              <Sparkles />
              {t('chatOpening.project.skills.label')}
            </Button>
          </div>

          <div
            className="mt-5 w-full truncate rounded-md bg-foreground/[0.025] px-2.5 py-2 font-mono text-[10px] text-muted-foreground/70"
            title={rootPath}
          >
            {rootPath}
          </div>
        </div>
      </div>
    </section>
  )
}
