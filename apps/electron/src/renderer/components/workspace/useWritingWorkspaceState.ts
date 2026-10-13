// input: Workspace catalog, scoped identity, current document save guards, and catalog/tab update callbacks
// output: File-tree expansion, entry-creation state, and create/import/move/rename/delete actions
// pos: Owns writing-workspace file operations; AppShell composes catalog loading and document editing

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as storage from '@/lib/local-storage'
import { navigate, routes } from '@/lib/navigate'
import type { WorkspaceFileTreeHandle, WorkspaceFileTreeNode } from './WorkspaceFileTree'
import type { WorkspaceCreateEntryTarget } from './useWorkspaceProjectSurface'
import {
  getDefaultWritingExpandedIds, isSameOrChildWorkspacePath, reduceWorkspaceStateAfterDeletion,
  resolveWorkspaceCreateRelativePath, resolveWorkspaceImportRelativePath,
} from './workspace-file-tree-model'
import {
  openNovelDocumentTab, mapNovelDocumentTabs, filterNovelDocumentTabs,
  type NovelDocumentTabsState, type NovelWorkspaceFile,
} from '@/lib/writing-workspace'

interface WritingWorkspaceStateOptions {
  activeWorkspaceId: string | null
  novelWorkspaceRoot: string | null
  novelWorkspaceFiles: NovelWorkspaceFile[]
  novelWorkspaceDirectories: string[]
  setNovelWorkspaceFiles: React.Dispatch<React.SetStateAction<NovelWorkspaceFile[]>>
  setNovelWorkspaceDirectories: React.Dispatch<React.SetStateAction<string[]>>
  setNovelDocumentTabs: React.Dispatch<React.SetStateAction<NovelDocumentTabsState>>
  selectedNovelFilePath: string | null
  isCurrentNovelDocumentDirty: () => boolean
  ensureNovelDocumentSavedRef: React.MutableRefObject<() => Promise<boolean>>
  invalidateNovelWorkspaceCatalogRequests: (rootPath: string) => void
  refreshNovelWorkspaceFilesAfterMutation: (rootPath: string) => Promise<boolean>
}

function joinWorkspacePath(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/[\\/]+$/, '')
  const relative = relativePath.replace(/^[\\/]+/, '')
  return relative ? `${root}/${relative}` : root
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function getWorkspaceRelativePathKey(path: string): string {
  return normalizeWorkspacePath(path).replace(/^\/+/, '').toLocaleLowerCase()
}

function remapWorkspacePath(path: string, sourcePath: string, destinationPath: string): string {
  const normalizedPath = normalizeWorkspacePath(path)
  const normalizedSource = normalizeWorkspacePath(sourcePath)
  if (normalizedPath === normalizedSource) return destinationPath
  if (!normalizedPath.startsWith(`${normalizedSource}/`)) return path
  return `${normalizeWorkspacePath(destinationPath)}${normalizedPath.slice(normalizedSource.length)}`
}

function getParentRelativePath(relativePath: string): string {
  const segments = relativePath.split('/')
  segments.pop()
  return segments.join('/')
}

function getMarkdownTitleFromRelativePath(relativePath: string): string {
  const fileName = relativePath.split('/').pop() ?? ''
  return fileName.replace(/\.[^/.]+$/, '').replace(/-/g, ' ').trim()
}

function shouldCreateMarkdownStarter(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith('.md')
}

export function useWritingWorkspaceState({
  activeWorkspaceId, novelWorkspaceRoot, novelWorkspaceFiles, novelWorkspaceDirectories,
  setNovelWorkspaceFiles, setNovelWorkspaceDirectories, setNovelDocumentTabs,
  selectedNovelFilePath, isCurrentNovelDocumentDirty, ensureNovelDocumentSavedRef,
  invalidateNovelWorkspaceCatalogRequests, refreshNovelWorkspaceFilesAfterMutation,
}: WritingWorkspaceStateOptions) {
  const { t } = useTranslation()
  // Unified sidebar keyboard navigation state. Expansion uses one positive,
  // workspace-scoped set so persisted state and rendered state cannot diverge.
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => {
    const persistedExpandedFolders = activeWorkspaceId
      ? storage.get<string[] | null>(storage.KEYS.expandedFolders, null, activeWorkspaceId)
      : null
    return new Set(persistedExpandedFolders ?? (activeWorkspaceId ? getDefaultWritingExpandedIds(activeWorkspaceId) : []))
  })
  const workspaceFileTreeRef = React.useRef<WorkspaceFileTreeHandle>(null)
  const handleWorkspaceTreeExpandedChange = React.useCallback((id: string, expanded: boolean) => {
    setExpandedFolders(prev => {
      if (prev.has(id) === expanded) return prev
      const next = new Set(prev)
      if (expanded) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const previousWorkspaceRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeWorkspaceId || previousWorkspaceRef.current === activeWorkspaceId) return
    const persistedExpandedFolders = storage.get<string[] | null>(storage.KEYS.expandedFolders, null, activeWorkspaceId)
    setExpandedFolders(new Set(persistedExpandedFolders ?? getDefaultWritingExpandedIds(activeWorkspaceId)))
    previousWorkspaceRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  // Persist expanded folders to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.expandedFolders, [...expandedFolders], activeWorkspaceId)
  }, [expandedFolders, activeWorkspaceId])

  const [workspaceCreateEntryTarget, setWorkspaceCreateEntryTarget] = React.useState<WorkspaceCreateEntryTarget | null>(null)
  const [workspaceCreateEntryValue, setWorkspaceCreateEntryValue] = React.useState('')
  const [workspaceCreatingEntry, setWorkspaceCreatingEntry] = React.useState(false)

  const openWorkspaceCreateEntryDialog = React.useCallback((target: WorkspaceCreateEntryTarget) => {
    setWorkspaceCreateEntryTarget(target)
    setWorkspaceCreateEntryValue('')
  }, [])

  const expandWorkspaceTreeDirectory = React.useCallback((relativePath: string) => {
    const id = relativePath
      ? `writing:folder:${relativePath}`
      : `writing:project:${activeWorkspaceId}`
    setExpandedFolders(previous => {
      if (previous.has(id)) return previous
      const next = new Set(previous)
      next.add(id)
      return next
    })
    requestAnimationFrame(() => workspaceFileTreeRef.current?.open(id))
  }, [activeWorkspaceId])

  const handleSubmitWorkspaceCreateEntry = React.useCallback(async () => {
    if (!novelWorkspaceRoot || !workspaceCreateEntryTarget) return

    const relativePath = resolveWorkspaceCreateRelativePath(
      workspaceCreateEntryTarget.parentRelativePath,
      workspaceCreateEntryValue,
      workspaceCreateEntryTarget.kind,
    )
    if (!relativePath) {
      toast.error(workspaceCreateEntryTarget.kind === 'file'
        ? t('writing.createFile.invalidName', '请输入有效文件名')
        : t('writing.createFolder.invalidName', '请输入有效文件夹名称'))
      return
    }
    const relativePathKey = getWorkspaceRelativePathKey(relativePath)
    const entryExists = novelWorkspaceFiles.some(file => getWorkspaceRelativePathKey(file.relativePath) === relativePathKey)
      || novelWorkspaceDirectories.some(directory => getWorkspaceRelativePathKey(directory) === relativePathKey)
    if (entryExists) {
      toast.error(workspaceCreateEntryTarget.kind === 'file'
        ? t('writing.createFile.exists', '文件已存在')
        : t('writing.createFolder.exists', '同名文件或文件夹已存在'))
      return
    }

    const targetPath = joinWorkspacePath(novelWorkspaceRoot, relativePath)
    if (workspaceCreateEntryTarget.kind === 'file' && !await ensureNovelDocumentSavedRef.current()) return
    setWorkspaceCreatingEntry(true)
    try {
      if (workspaceCreateEntryTarget.kind === 'directory') {
        await window.electronAPI.createDirectory(targetPath)
      } else {
        const parentRelativePath = getParentRelativePath(relativePath)
        const parentPath = joinWorkspacePath(novelWorkspaceRoot, parentRelativePath)
        const title = getMarkdownTitleFromRelativePath(relativePath)
        const initialContent = shouldCreateMarkdownStarter(relativePath) && title ? `# ${title}\n\n` : ''
        await window.electronAPI.createDirectory(parentPath)
        await window.electronAPI.writeFile(targetPath, initialContent)
      }
      await refreshNovelWorkspaceFilesAfterMutation(novelWorkspaceRoot)
      expandWorkspaceTreeDirectory(workspaceCreateEntryTarget.parentRelativePath)
      if (workspaceCreateEntryTarget.kind === 'file') {
        setNovelDocumentTabs(current => openNovelDocumentTab(current, novelWorkspaceRoot, targetPath))
        navigate(routes.view.writing())
      }
      setWorkspaceCreateEntryTarget(null)
      setWorkspaceCreateEntryValue('')
    } catch (error) {
      console.error('[AppShell] Failed to create workspace entry:', error)
      toast.error(workspaceCreateEntryTarget.kind === 'file'
        ? t('writing.createFile.failed', '创建文件失败')
        : t('writing.createFolder.failed', '创建文件夹失败'))
    } finally {
      setWorkspaceCreatingEntry(false)
    }
  }, [
    expandWorkspaceTreeDirectory,
    novelWorkspaceDirectories,
    novelWorkspaceFiles,
    novelWorkspaceRoot,
    refreshNovelWorkspaceFilesAfterMutation,
    t,
    workspaceCreateEntryTarget,
    workspaceCreateEntryValue,
  ])

  const handleImportNovelFiles = React.useCallback(async (parentRelativePath: string) => {
    if (!novelWorkspaceRoot) return

    const sourcePaths = await window.electronAPI.openFileDialog()
    if (sourcePaths.length === 0) return
    if (!await ensureNovelDocumentSavedRef.current()) return

    let importedCount = 0
    let skippedCount = 0
    let lastImportedPath: string | null = null
    const reservedRelativePathKeys = new Set([
      ...novelWorkspaceFiles.map(file => getWorkspaceRelativePathKey(file.relativePath)),
      ...novelWorkspaceDirectories.map(getWorkspaceRelativePathKey),
    ])

    for (const sourcePath of sourcePaths) {
      const relativePath = resolveWorkspaceImportRelativePath(parentRelativePath, sourcePath)
      const relativePathKey = relativePath ? getWorkspaceRelativePathKey(relativePath) : null
      if (!relativePath || !relativePathKey || reservedRelativePathKeys.has(relativePathKey)) {
        skippedCount += 1
        continue
      }

      try {
        const attachment = await window.electronAPI.readUserAttachment(sourcePath)
        if (!attachment || attachment.text === undefined) {
          skippedCount += 1
          continue
        }

        const targetPath = joinWorkspacePath(novelWorkspaceRoot, relativePath)
        const parentRelativePath = getParentRelativePath(relativePath)
        const parentPath = joinWorkspacePath(novelWorkspaceRoot, parentRelativePath)

        await window.electronAPI.createDirectory(parentPath)
        await window.electronAPI.writeFile(targetPath, attachment.text)
        importedCount += 1
        reservedRelativePathKeys.add(relativePathKey)
        lastImportedPath = targetPath
      } catch (error) {
        console.error('[AppShell] Failed to import writing file:', error)
        skippedCount += 1
      }
    }

    if (importedCount > 0) {
      await refreshNovelWorkspaceFilesAfterMutation(novelWorkspaceRoot)
      expandWorkspaceTreeDirectory(parentRelativePath)
      if (lastImportedPath) {
        setNovelDocumentTabs(current => openNovelDocumentTab(current, novelWorkspaceRoot, lastImportedPath))
        navigate(routes.view.writing())
      }
      toast.success(t('writing.importFile.success', '已导入文件'))
    }
    if (skippedCount > 0) {
      toast.error(t('writing.importFile.skipped', '部分文件未导入，仅支持不重名的 md/txt 文件'))
    }
  }, [
    expandWorkspaceTreeDirectory,
    novelWorkspaceDirectories,
    novelWorkspaceFiles,
    novelWorkspaceRoot,
    refreshNovelWorkspaceFilesAfterMutation,
    t,
  ])

  const handleMoveNovelWorkspaceEntry = React.useCallback(async (
    entry: WorkspaceFileTreeNode,
    destinationDirectory: WorkspaceFileTreeNode,
    newName?: string,
  ) => {
    if (!novelWorkspaceRoot || entry.type === 'root' || destinationDirectory.type === 'file') return
    if (isSameOrChildWorkspacePath(selectedNovelFilePath, entry.path) && isCurrentNovelDocumentDirty()) {
      toast.error(t('writing.moveFile.unsaved', '当前文件有未保存修改，请先保存后再移动或重命名'))
      return
    }

    try {
      const result = await window.electronAPI.moveWorkspaceEntry({
        sourcePath: entry.path,
        destinationDirectoryPath: destinationDirectory.path,
        newName,
      })
      if (result.sourcePath === result.destinationPath) return

      const destinationName = newName ?? entry.name
      const destinationRelativePath = destinationDirectory.relativePath
        ? `${destinationDirectory.relativePath}/${destinationName}`
        : destinationName

      invalidateNovelWorkspaceCatalogRequests(novelWorkspaceRoot)
      setNovelWorkspaceFiles(previous => previous.map(file => (
        isSameOrChildWorkspacePath(file.path, result.sourcePath)
          ? {
              ...file,
              path: remapWorkspacePath(file.path, result.sourcePath, result.destinationPath),
              relativePath: remapWorkspacePath(file.relativePath, entry.relativePath, destinationRelativePath),
            }
          : file
      )))
      if (entry.type === 'directory') {
        setNovelWorkspaceDirectories(previous => previous.map(directory => (
          isSameOrChildWorkspacePath(directory, entry.relativePath)
            ? remapWorkspacePath(directory, entry.relativePath, destinationRelativePath)
            : directory
        )))
        const sourceFolderId = `writing:folder:${entry.relativePath}`
        const destinationFolderId = `writing:folder:${destinationRelativePath}`
        setExpandedFolders(previous => {
          let changed = false
          const next = new Set<string>()
          for (const id of previous) {
            if (id === sourceFolderId || id.startsWith(`${sourceFolderId}/`)) {
              next.add(`${destinationFolderId}${id.slice(sourceFolderId.length)}`)
              changed = true
            } else {
              next.add(id)
            }
          }
          return changed ? next : previous
        })
      }
      setNovelDocumentTabs(current => mapNovelDocumentTabs(
        current,
        path => isSameOrChildWorkspacePath(path, result.sourcePath)
          ? remapWorkspacePath(path, result.sourcePath, result.destinationPath)
          : path,
      ))

      toast.success(newName
        ? t('writing.renameFile.success', '已重命名')
        : t('writing.moveFile.success', '已移动'))
    } catch (error) {
      console.error('[AppShell] Failed to move workspace entry:', error)
      toast.error(newName
        ? t('writing.renameFile.failed', '重命名失败')
        : t('writing.moveFile.failed', '移动失败'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [
    invalidateNovelWorkspaceCatalogRequests,
    isCurrentNovelDocumentDirty,
    novelWorkspaceRoot,
    selectedNovelFilePath,
    t,
  ])

  const handleRenameNovelWorkspaceEntry = React.useCallback((entry: WorkspaceFileTreeNode, newName: string) => {
    if (!novelWorkspaceRoot) return
    const parentRelativePath = getParentRelativePath(entry.relativePath)
    const destinationDirectory: WorkspaceFileTreeNode = {
      id: parentRelativePath ? `writing:folder:${parentRelativePath}` : `writing:project:${activeWorkspaceId}`,
      name: '',
      path: joinWorkspacePath(novelWorkspaceRoot, parentRelativePath),
      relativePath: parentRelativePath,
      type: parentRelativePath ? 'directory' : 'root',
      fileCount: 0,
      children: [],
    }
    return handleMoveNovelWorkspaceEntry(entry, destinationDirectory, newName)
  }, [activeWorkspaceId, handleMoveNovelWorkspaceEntry, novelWorkspaceRoot])

  const handleDeleteNovelWorkspaceEntry = React.useCallback(async (entry: WorkspaceFileTreeNode) => {
    if (!novelWorkspaceRoot || entry.type === 'root') return
    if (isSameOrChildWorkspacePath(selectedNovelFilePath, entry.path) && isCurrentNovelDocumentDirty()) {
      toast.error(t('writing.deleteFile.unsaved', '当前文件有未保存修改，请先保存或切换文件'))
      return
    }

    const confirmed = window.confirm(t(
      entry.type === 'directory' ? 'writing.deleteFolder.confirm' : 'writing.deleteFile.confirm',
      entry.type === 'directory'
        ? '删除文件夹「{{name}}」及其中全部内容？此操作无法撤销。'
        : '删除「{{name}}」？此操作无法撤销。',
      { name: entry.name },
    ))
    if (!confirmed) return

    try {
      await window.electronAPI.deleteWorkspaceEntry({
        path: entry.path,
        recursive: entry.type === 'directory',
      })
      const nextState = reduceWorkspaceStateAfterDeletion({
        files: novelWorkspaceFiles,
        directories: novelWorkspaceDirectories,
        expandedIds: expandedFolders,
        selectedPath: selectedNovelFilePath,
        entry: {
          path: entry.path,
          relativePath: entry.relativePath,
          type: entry.type,
        },
      })

      invalidateNovelWorkspaceCatalogRequests(novelWorkspaceRoot)
      setNovelWorkspaceFiles(nextState.files)
      setNovelWorkspaceDirectories(nextState.directories)
      setExpandedFolders(nextState.expandedIds)
      setNovelDocumentTabs(current => filterNovelDocumentTabs(
        current,
        path => !isSameOrChildWorkspacePath(path, entry.path),
      ))
      toast.success(t('writing.deleteFile.success', '已删除'))
    } catch (error) {
      console.error('[AppShell] Failed to delete workspace entry:', error)
      toast.error(t('writing.deleteFile.failed', '删除失败'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [
    invalidateNovelWorkspaceCatalogRequests,
    isCurrentNovelDocumentDirty,
    expandedFolders,
    novelWorkspaceDirectories,
    novelWorkspaceFiles,
    novelWorkspaceRoot,
    selectedNovelFilePath,
    t,
  ])

  return {
    expandedFolders, workspaceFileTreeRef, handleWorkspaceTreeExpandedChange,
    workspaceCreateEntryTarget, setWorkspaceCreateEntryTarget,
    workspaceCreateEntryValue, setWorkspaceCreateEntryValue, workspaceCreatingEntry,
    openWorkspaceCreateEntryDialog, handleSubmitWorkspaceCreateEntry, handleImportNovelFiles,
    handleMoveNovelWorkspaceEntry, handleRenameNovelWorkspaceEntry, handleDeleteNovelWorkspaceEntry,
  }
}
