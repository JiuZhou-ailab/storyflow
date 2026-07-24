// input: Project runtime state plus existing create, import, and navigation actions
// output: Empty-chat project state and explicit opening command handler
// pos: Project-surface orchestration seam outside the top-level AppShell

import * as React from 'react'
import type { ChatOpeningCommand } from '@/components/app-shell/chat-opening'
import type { WorkspaceCreateEntryKind } from './workspace-file-tree-model'

export interface WorkspaceCreateEntryTarget {
  kind: WorkspaceCreateEntryKind
  parentRelativePath: string
  title: string
  placeholder: string
}

interface UseWorkspaceProjectSurfaceOptions {
  isProjectRuntime: boolean
  fileCount: number
  directoryCount: number
  createFileTitle: string
  createFilePlaceholder: string
  openCreateEntryDialog: (target: WorkspaceCreateEntryTarget) => void
  importFiles: (parentRelativePath: string) => void | Promise<void>
  openSkills: () => void
}

export function useWorkspaceProjectSurface({
  isProjectRuntime,
  fileCount,
  directoryCount,
  createFileTitle,
  createFilePlaceholder,
  openCreateEntryDialog,
  importFiles,
  openSkills,
}: UseWorkspaceProjectSurfaceOptions) {
  const openingProjectState = React.useMemo(() => isProjectRuntime
    ? { hasUserContent: fileCount > 0 || directoryCount > 0 }
    : undefined, [directoryCount, fileCount, isProjectRuntime])

  const handleOpeningCommand = React.useCallback((command: ChatOpeningCommand) => {
    if (command === 'create-file') {
      openCreateEntryDialog({
        kind: 'file',
        parentRelativePath: '',
        title: createFileTitle,
        placeholder: createFilePlaceholder,
      })
      return
    }

    if (command === 'import-files') {
      void importFiles('')
      return
    }

    openSkills()
  }, [
    createFilePlaceholder,
    createFileTitle,
    importFiles,
    openCreateEntryDialog,
    openSkills,
  ])

  return {
    openingProjectState,
    handleOpeningCommand,
  }
}
