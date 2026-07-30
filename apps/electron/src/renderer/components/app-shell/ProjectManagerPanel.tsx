// input: Local project creation callback
// output: One focused folder-first project form inside a dialog panel
// pos: Local project creation surface; project browsing and lifecycle actions live in ActivityRail

import * as React from 'react'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AddWorkspaceStep_CreateNew } from '@/components/workspace/AddWorkspaceStep_CreateNew'
import type { Workspace } from '../../../shared/types'

export interface ProjectManagerPanelProps {
  onWorkspaceCreated: (workspace: Workspace) => void | Promise<void>
  onRequestClose: () => void
  className?: string
}

const EMBEDDED_STEP_CLASS =
  'h-full min-h-0 max-h-none max-w-none w-full items-stretch'

export function ProjectManagerPanel({
  onWorkspaceCreated,
  onRequestClose,
  className,
}: ProjectManagerPanelProps) {
  const [isCreating, setIsCreating] = React.useState(false)

  const handleCreateWorkspace = React.useCallback(async (
    folderPath: string,
    name: string,
  ) => {
    setIsCreating(true)
    try {
      const workspace = await window.electronAPI.createWorkspace(folderPath, name)
      await onWorkspaceCreated(workspace)
      onRequestClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('创建项目失败', { description: message })
    } finally {
      setIsCreating(false)
    }
  }, [onRequestClose, onWorkspaceCreated])

  return (
    <div
      data-testid="project-manager-panel"
      data-variant="dialog"
      className={cn(
        'flex min-h-[min(500px,72vh)] w-full flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-modal-small',
        className,
      )}
    >
      <header className="border-b border-foreground/[0.06] px-5 py-3.5 sm:px-7">
        <div className="mx-auto flex w-full max-w-[968px] items-center gap-3">
          <button
            type="button"
            onClick={onRequestClose}
            disabled={isCreating}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.8} />
            返回
          </button>
          <span className="h-4 w-px bg-foreground/[0.10]" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">
              创建本地项目
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              选择本地文件夹；名称可选，留空时使用文件夹名称。
            </p>
          </div>
        </div>
      </header>
      <div
        className={cn(
          'mx-auto flex min-h-0 w-full max-w-[600px] flex-1 flex-col overflow-hidden px-5 py-5 sm:px-7 sm:py-6',
        )}
      >
        <AddWorkspaceStep_CreateNew
          onBack={onRequestClose}
          onCreate={handleCreateWorkspace}
          isCreating={isCreating}
          className={EMBEDDED_STEP_CLASS}
          embedded
        />
      </div>
    </div>
  )
}
