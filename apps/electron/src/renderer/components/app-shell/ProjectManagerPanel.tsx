// input: Selected project-creation mode and create/import/remote callback
// output: One focused project-creation form inside a dialog panel
// pos: Creation-only surface; project browsing and lifecycle actions live in ActivityRail

import * as React from 'react'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AddWorkspaceStep_CreateNew } from '@/components/workspace/AddWorkspaceStep_CreateNew'
import { AddWorkspaceStep_OpenFolder } from '@/components/workspace/AddWorkspaceStep_OpenFolder'
import { AddWorkspaceStep_ConnectRemote } from '@/components/workspace/AddWorkspaceStep_ConnectRemote'
import type { RemoteServerConnectionInput, Workspace } from '../../../shared/types'

export type ProjectManagerView = 'create' | 'open' | 'remote'

export interface ProjectManagerPanelProps {
  view: ProjectManagerView
  onWorkspaceCreated: (workspace: Workspace) => void | Promise<void>
  onRequestClose: () => void
  className?: string
}

const EMBEDDED_STEP_CLASS =
  'h-full min-h-0 max-h-none max-w-none w-full items-stretch'

const PROJECT_STEP_COPY: Record<ProjectManagerView, { title: string; description: string }> = {
  create: {
    title: '创建项目',
    description: '输入名称，并选择新项目的存储位置。',
  },
  open: {
    title: '导入文件夹',
    description: '将已有写作目录加入项目列表。',
  },
  remote: {
    title: '连接远端',
    description: '连接已有的 Storyflow Server。',
  },
}

export function ProjectManagerPanel({
  view,
  onWorkspaceCreated,
  onRequestClose,
  className,
}: ProjectManagerPanelProps) {
  const [isCreating, setIsCreating] = React.useState(false)
  const stepCopy = PROJECT_STEP_COPY[view]

  const handleCreateWorkspace = React.useCallback(async (
    folderPath: string,
    name: string,
    remoteServer?: RemoteServerConnectionInput,
  ) => {
    setIsCreating(true)
    try {
      const workspace = remoteServer
        ? await window.electronAPI.createWorkspace(folderPath, name, { remoteServer })
        : await window.electronAPI.createWorkspace(folderPath, name)
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
      data-view={view}
      className={cn(
        'flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-modal-small',
        view === 'create'
          ? 'h-[min(720px,calc(100vh-4rem))]'
          : 'min-h-[min(500px,72vh)]',
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
              {stepCopy.title}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {stepCopy.description}
            </p>
          </div>
        </div>
      </header>
      <div
        className={cn(
          'mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden px-5 py-5 sm:px-7 sm:py-6',
          view === 'create' ? 'max-w-[968px]' : 'max-w-[600px]',
        )}
      >
        {view === 'create' ? (
          <AddWorkspaceStep_CreateNew
            onBack={onRequestClose}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
            className={EMBEDDED_STEP_CLASS}
            embedded
          />
        ) : null}
        {view === 'open' ? (
          <AddWorkspaceStep_OpenFolder
            onBack={onRequestClose}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
            className={EMBEDDED_STEP_CLASS}
            embedded
          />
        ) : null}
        {view === 'remote' ? (
          <AddWorkspaceStep_ConnectRemote
            onBack={onRequestClose}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
            className={EMBEDDED_STEP_CLASS}
            embedded
          />
        ) : null}
      </div>
    </div>
  )
}
