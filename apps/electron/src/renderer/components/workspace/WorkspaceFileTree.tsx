// input: Controlled workspace catalog, selection/expansion state, and file mutation callbacks
// output: Virtualized, keyboard-accessible Finder-style tree synchronized to external state
// pos: Workspace file navigation boundary and React Arborist state adapter

import * as React from 'react'
import { Tree, type MoveHandler, type RenameHandler, type TreeApi } from 'react-arborist'
import type { NovelWorkspaceFile } from '@/lib/writing-workspace'
import {
  buildWorkspaceFileTree,
  collectWorkspaceTreeDirectoryIds,
  getWorkspaceTreeExpansionDelta,
  type WorkspaceFileTreeNode,
} from './workspace-file-tree-model'
import {
  WorkspaceFileTreeRow,
  WorkspaceFileTreeRowContext,
  type WorkspaceFileTreeLabels,
  type WorkspaceFileTreeMenuAction,
} from './WorkspaceFileTreeRow'

const ROW_HEIGHT = 30
const TREE_OVERSCAN_ROWS = 8

export type { WorkspaceFileTreeMenuAction, WorkspaceFileTreeNode }

export interface WorkspaceFileTreeHandle {
  focusSelected(): void
  open(id: string): void
}

export interface WorkspaceFileTreeProps {
  workspaceId: string
  workspaceName: string
  rootPath: string
  files: readonly NovelWorkspaceFile[]
  directories: readonly string[]
  selectedPath?: string | null
  expandedIds: ReadonlySet<string>
  labels: WorkspaceFileTreeLabels
  onExpandedChange: (id: string, expanded: boolean) => void
  onSelectFile: (file: NovelWorkspaceFile) => void
  onMoveEntry: (entry: WorkspaceFileTreeNode, destinationDirectory: WorkspaceFileTreeNode) => void | Promise<void>
  onRenameEntry: (entry: WorkspaceFileTreeNode, newName: string) => void | Promise<void>
  onDeleteEntry: (entry: WorkspaceFileTreeNode) => void
  getMenuActions?: (entry: WorkspaceFileTreeNode) => readonly WorkspaceFileTreeMenuAction[]
  hasReviewDot?: (path: string) => boolean
  onDismissReviewDot?: (path: string) => void
  onError?: (error: unknown) => void
  /** Grow to the visible rows so an ancestor can own the only scrollbar. */
  fitContent?: boolean
}

const TREE_VERTICAL_PADDING = 8

function useElementHeight(elementRef: React.RefObject<HTMLElement>): number {
  const [height, setHeight] = React.useState(1)

  React.useLayoutEffect(() => {
    const element = elementRef.current
    if (!element) return

    const updateHeight = () => setHeight(Math.max(1, Math.floor(element.getBoundingClientRect().height)))
    updateHeight()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [elementRef])

  return height
}

function countVisibleRows(
  node: WorkspaceFileTreeNode,
  expandedIds: ReadonlySet<string>,
): number {
  if (!node.children || !expandedIds.has(node.id)) return 1
  return 1 + node.children.reduce(
    (count, child) => count + countVisibleRows(child, expandedIds),
    0,
  )
}

export const WorkspaceFileTree = React.forwardRef<WorkspaceFileTreeHandle, WorkspaceFileTreeProps>(
  function WorkspaceFileTree({
    workspaceId,
    workspaceName,
    rootPath,
    files,
    directories,
    selectedPath,
    expandedIds,
    labels,
    onExpandedChange,
    onSelectFile,
    onMoveEntry,
    onRenameEntry,
    onDeleteEntry,
    getMenuActions,
    hasReviewDot,
    onDismissReviewDot,
    onError,
    fitContent = false,
  }, forwardedRef) {
    const containerRef = React.useRef<HTMLDivElement>(null)
    const treeRef = React.useRef<TreeApi<WorkspaceFileTreeNode> | null>(null)
    const syncingExpandedStateRef = React.useRef(false)
    const appliedExpandedIdsRef = React.useRef<Set<string>>(new Set())
    const measuredHeight = useElementHeight(containerRef)

    const root = React.useMemo(() => buildWorkspaceFileTree({
      workspaceId,
      workspaceName,
      rootPath,
      files,
      directories,
    }), [directories, files, rootPath, workspaceId, workspaceName])
    const data = React.useMemo(() => [root], [root])
    const directoryIds = React.useMemo(
      () => collectWorkspaceTreeDirectoryIds(root),
      [root],
    )
    const directoryIdSet = React.useMemo(
      () => new Set(directoryIds),
      [directoryIds],
    )
    const visibleRowCount = React.useMemo(
      () => countVisibleRows(root, expandedIds),
      [expandedIds, root],
    )
    const treeHeight = fitContent
      ? Math.max(ROW_HEIGHT, visibleRowCount * ROW_HEIGHT)
      : measuredHeight
    const selectionId = selectedPath ? `writing:file:${selectedPath}` : undefined
    const initialOpenState = React.useMemo(() => {
      const state: Record<string, boolean> = {}
      for (const id of expandedIds) state[id] = true
      return state
    }, [expandedIds])

    const handleMove = React.useCallback<MoveHandler<WorkspaceFileTreeNode>>(async ({ dragNodes, parentNode }) => {
      const entry = dragNodes[0]?.data
      const destinationDirectory = parentNode?.data
      if (!entry || !destinationDirectory || destinationDirectory.type === 'file') return
      try {
        await onMoveEntry(entry, destinationDirectory)
      } catch (error) {
        onError?.(error)
      }
    }, [onError, onMoveEntry])

    const handleRename = React.useCallback<RenameHandler<WorkspaceFileTreeNode>>(async ({ node, name }) => {
      if (name === node.data.name) return
      try {
        await onRenameEntry(node.data, name)
      } catch (error) {
        onError?.(error)
      }
    }, [onError, onRenameEntry])

    const handleActivate = React.useCallback((node: { data: WorkspaceFileTreeNode; toggle(): void }) => {
      if (node.data.type === 'file') {
        onSelectFile({ path: node.data.path, relativePath: node.data.relativePath })
      } else {
        node.toggle()
      }
    }, [onSelectFile])

    const handleToggle = React.useCallback((id: string) => {
      if (syncingExpandedStateRef.current) return
      const tree = treeRef.current
      if (!tree) return
      onExpandedChange(id, tree.isOpen(id))
    }, [onExpandedChange])

    React.useLayoutEffect(() => {
      const tree = treeRef.current
      if (!tree) return

      const {
        desiredExpandedIds,
        openIds,
        closeIds,
      } = getWorkspaceTreeExpansionDelta({
        directoryIds: directoryIdSet,
        expandedIds,
        appliedExpandedIds: appliedExpandedIdsRef.current,
      })

      syncingExpandedStateRef.current = true
      try {
        for (const id of closeIds) tree.close(id)
        for (const id of openIds) tree.open(id)
      } finally {
        syncingExpandedStateRef.current = false
        appliedExpandedIdsRef.current = desiredExpandedIds
      }
    }, [directoryIdSet, expandedIds])

    const rowContext = React.useMemo(() => ({
      labels,
      getMenuActions,
      onDelete: onDeleteEntry,
      hasReviewDot,
      onDismissReviewDot,
    }), [getMenuActions, hasReviewDot, labels, onDeleteEntry, onDismissReviewDot])

    React.useImperativeHandle(forwardedRef, () => ({
      focusSelected() {
        const tree = treeRef.current
        if (!tree) return
        const selectedNode = selectionId ? tree.get(selectionId) : null
        const target = selectedNode ?? tree.visibleNodes[0]
        target?.openParents()
        requestAnimationFrame(() => target?.focus())
      },
      open(id: string) {
        treeRef.current?.open(id)
      },
    }), [selectionId])

    return (
      <div
        ref={containerRef}
        className={fitContent
          ? 'w-full overflow-hidden py-1 [&_[role=tree]>div]:!overflow-hidden'
          : 'h-full min-h-0 w-full overflow-hidden px-2 py-1'}
        style={fitContent ? { height: treeHeight + TREE_VERTICAL_PADDING } : undefined}
      >
        <WorkspaceFileTreeRowContext.Provider value={rowContext}>
          <Tree<WorkspaceFileTreeNode>
            key={workspaceId}
            ref={treeRef}
            data={data}
            idAccessor="id"
            childrenAccessor="children"
            width="100%"
            height={treeHeight}
            rowHeight={ROW_HEIGHT}
            rowClassName={fitContent ? '!min-w-0 overflow-hidden' : undefined}
            indent={14}
            overscanCount={TREE_OVERSCAN_ROWS}
            openByDefault={false}
            initialOpenState={initialOpenState}
            selection={selectionId}
            disableMultiSelection
            disableDrag={entry => entry.type === 'root'}
            disableEdit={entry => entry.type === 'root'}
            disableDrop={({ parentNode, dragNodes }) => (
              !parentNode
              || parentNode.data.type === 'file'
              || dragNodes.every(node => node.parent?.id === parentNode.id)
            )}
            onActivate={handleActivate}
            onToggle={handleToggle}
            onMove={handleMove}
            onRename={handleRename}
            aria-label={workspaceName}
          >
            {WorkspaceFileTreeRow}
          </Tree>
        </WorkspaceFileTreeRowContext.Provider>
      </div>
    )
  },
)
