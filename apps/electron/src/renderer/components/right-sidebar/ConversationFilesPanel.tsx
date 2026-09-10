// input: Active conversation identity, optional file-open intent and session file RPC/events
// output: Session-owned file groups and a single read-only preview with live refresh
// pos: Conversation-owned data adapter for existing workspace layout, tabs, tree and preview

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FolderOpen, PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react'
import type { ConversationFile, ConversationFiles } from '../../../shared/types'
import { FileViewer } from '../files/FileViewer'
import { HeaderIconButton } from '../ui/HeaderIconButton'
import { ResizableColumn } from '../app-shell/ResizableColumn'
import { PANEL_MIN_WIDTH, WORKSPACE_DIRECTORY_DEFAULT_WIDTH } from '../app-shell/panel-constants'
import { DEFAULT_WORKSPACE_WIDTH } from '../app-shell/layout-defaults'
import { WorkspaceDockLayout } from '../workspace/WorkspaceDockLayout'
import { NovelDocumentTabStrip } from '../writing/NovelDocumentTabStrip'
import { Button } from '../ui/button'
import type { NovelWorkspaceFile } from '@/lib/writing-workspace'
import { toast } from 'sonner'

const WorkspaceFileTree = React.lazy(async () => {
  const module = await import('../workspace/WorkspaceFileTree')
  return { default: module.WorkspaceFileTree }
})

/** Shell orchestration stays outside the project editor's state and save lifecycle. */
export function useConversationWorkspace({ sessionId, active, compact, availableWidth, onOpenFile }: {
  sessionId?: string
  active: boolean
  compact: boolean
  availableWidth: number
  onOpenFile: (path: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [width, setWidth] = React.useState(DEFAULT_WORKSPACE_WIDTH + WORKSPACE_DIRECTORY_DEFAULT_WIDTH)
  const owner = React.useMemo(() => ({}), [sessionId, active, compact])
  const [requested, setRequested] = React.useState<{ owner: object; path: string } | null>(null)
  const current = React.useRef({ owner, sessionId, active, compact, onOpenFile, t })
  current.current = { owner, sessionId, active, compact, onOpenFile, t }
  const openRequest = React.useRef(0)
  const stopResize = React.useRef<(() => void) | undefined>(undefined)
  React.useEffect(() => () => { stopResize.current?.(); openRequest.current += 1 }, [])
  React.useEffect(() => { stopResize.current?.() }, [sessionId, active, compact])
  const maxWidth = Math.max(PANEL_MIN_WIDTH, availableWidth - PANEL_MIN_WIDTH)
  const shownWidth = Math.min(width, maxWidth)
  // Completed message cards retain callbacks; resolve their intents against the current shell.
  const openFile = React.useCallback(async (path: string) => {
    const { owner, sessionId, active, compact, onOpenFile, t } = current.current
    if (!active || !sessionId) { onOpenFile(path); return }
    const generation = ++openRequest.current
    let content: ConversationFiles
    try {
      content = await window.electronAPI.getSessionFiles(sessionId, 'conversation')
    } catch (cause) {
      if (generation === openRequest.current && current.current.owner === owner) {
        toast.error(t('conversationFiles.loadFailed'), { description: String(cause) })
      }
      return
    }
    if (generation !== openRequest.current || current.current.owner !== owner) return
    if (!findConversationFile(content, path)) { onOpenFile(path); return }
    setRequested({ owner, path })
    if (!compact) setOpen(true)
  }, [])
  const button = active && !compact ? <HeaderIconButton
    icon={open ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
    tooltip={t(open ? 'conversationFiles.collapse' : 'conversationFiles.expand')}
    aria-label={t(open ? 'conversationFiles.collapse' : 'conversationFiles.expand')}
    aria-expanded={open} onClick={() => setOpen(value => !value)} className="h-[26px] w-[26px] rounded-lg" /> : null
  const panel = active && !compact && open ? <ResizableColumn mode="document-dock" role="conversation-files"
    sashLabel={t('conversationFiles.title')} width={shownWidth} disableAnimation
    onResizeStart={(_mode, event) => {
      event.preventDefault()
      stopResize.current?.()
      const startX = event.clientX
      const move = (next: MouseEvent) => setWidth(Math.min(maxWidth, Math.max(PANEL_MIN_WIDTH, shownWidth + startX - next.clientX)))
      const stop = () => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', stop)
        stopResize.current = undefined
      }
      stopResize.current = stop
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', stop)
    }}>
    <ConversationFilesPanel sessionId={sessionId} requestedFile={requested?.owner === owner ? requested : undefined} onClose={() => { stopResize.current?.(); setOpen(false) }} />
  </ResizableColumn> : null
  const drawerRequest = React.useMemo(() => compact && requested?.owner === owner && sessionId
    ? { path: requested.path, sessionId } : undefined, [compact, requested, owner, sessionId])
  return { button, panel, openFile, drawerRequest }
}

export function findConversationFile(content: ConversationFiles, path: string): ConversationFile | undefined {
  const find = (files: ConversationFile[]): ConversationFile | undefined => {
    for (const file of files) {
      if (file.type === 'file' && file.path === path) return file
      const child = file.children && find(file.children)
      if (child) return child
    }
  }
  for (const group of content.groups) {
    const file = find(group.files)
    if (file) return file
  }
}

interface Props {
  sessionId?: string
  requestedFile?: { path: string }
  onClose?: () => void
  compact?: boolean
}

// Reset all asynchronous state synchronously when ownership changes, including in an open drawer.
export function ConversationFilesPanel(props: Props) {
  return <ConversationFilesContent key={props.sessionId ?? 'empty'} {...props} />
}

function ConversationFilesContent({ sessionId, requestedFile, onClose, compact }: Props) {
  const { t } = useTranslation()
  const [content, setContent] = React.useState<ConversationFiles>({ groups: [], truncated: false })
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(Boolean(sessionId))
  const [selectedPath, setSelectedPath] = React.useState<string | undefined>(requestedFile?.path)
  const [expanded, setExpanded] = React.useState(() => new Set(['work', 'downloads', 'attachments'].map(kind => `${kind}/writing:project:conversation:${kind}`)))
  const [directoryVisible, setDirectoryVisible] = React.useState(true)
  const [revision, setRevision] = React.useState(0)
  const [retry, setRetry] = React.useState(0)

  React.useEffect(() => { setSelectedPath(requestedFile?.path) }, [requestedFile])

  React.useEffect(() => {
    if (!sessionId) return
    let alive = true
    let request = 0
    const consumerId = `conversation-files:${crypto.randomUUID()}`
    const reload = async () => {
      const version = ++request
      try {
        const next = await window.electronAPI.getSessionFiles(sessionId, 'conversation')
        if (!alive || version !== request) return
        setContent(next)
        setError(null)
      } catch (cause) {
        if (alive && version === request) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (alive && version === request) setLoading(false)
      }
    }
    const connect = async () => {
      try {
        await window.electronAPI.watchSessionFiles(sessionId, consumerId)
        // A close while subscribing must not resurrect a listener after cleanup.
        if (!alive) { await window.electronAPI.unwatchSessionFiles(consumerId); return }
        await reload()
      } catch (cause) {
        if (alive) { setError(String(cause)); setLoading(false) }
      }
    }
    setLoading(true)
    void connect()
    const stopFiles = window.electronAPI.onSessionFilesChanged(id => { if (id === sessionId) void reload() })
    const stopReconnect = window.electronAPI.onReconnected(() => { void connect() })
    return () => {
      alive = false
      stopFiles()
      stopReconnect()
      void window.electronAPI.unwatchSessionFiles(consumerId)
    }
  }, [sessionId, retry])

  const selected = selectedPath ? findConversationFile(content, selectedPath) : undefined
  const reveal = (path: string) => { void window.electronAPI.showInFolder(path) }
  const toggleFolder = (id: string, open: boolean) => setExpanded(previous => {
    const next = new Set(previous)
    if (open) next.add(id)
    else next.delete(id)
    return next
  })
  const empty = !loading && !error && content.groups.length === 0
  const groups = React.useMemo(() => content.groups.map(group => {
    const files: NovelWorkspaceFile[] = []
    const directories: string[] = []
    const visit = (entries: ConversationFile[], parent = '') => {
      for (const file of entries) {
        const relativePath = parent + file.name + (file.unavailable ? ` (${t('conversationFiles.unavailable')})` : '')
        if (file.type === 'directory') { directories.push(relativePath); visit(file.children ?? [], `${relativePath}/`) }
        else files.push({ path: file.path, relativePath })
      }
    }
    visit(group.files)
    return { kind: group.kind, files, directories }
  }), [content, t])
  const directory = (
    <nav aria-label={t('conversationFiles.title')} className="flex min-h-full flex-col font-sans">
      <React.Suspense fallback={<p role="status" className="px-4 text-xs text-muted-foreground">{t('conversationFiles.loading')}</p>}>
        {/* Group roots are presentation labels; only original file paths have actions. */}
        {groups.map(group => <WorkspaceFileTree key={group.kind}
          workspaceId={`conversation:${group.kind}`} workspaceName={t(`conversationFiles.groups.${group.kind}`)}
          rootPath="" files={group.files} directories={group.directories} fitContent
          selectedPath={selectedPath}
          expandedIds={new Set([...expanded].filter(id => id.startsWith(`${group.kind}/`)).map(id => id.slice(group.kind.length + 1)))}
          onExpandedChange={(id, open) => toggleFolder(`${group.kind}/${id}`, open)}
          labels={{ rename: t('common.rename'), delete: t('common.delete') }}
          onSelectFile={file => setSelectedPath(file.path)}
          getMenuActions={entry => entry.type === 'file' ? [{ id: 'reveal', label: t('conversationFiles.reveal'), onSelect: () => reveal(entry.path) }] : []}
        />)}
      </React.Suspense>
      {content.truncated && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{t('conversationFiles.truncated')}</p>}
    </nav>
  )
  const directoryLabel = t(directoryVisible ? 'writing.directory.collapse' : 'writing.directory.expand')
  const header = <NovelDocumentTabStrip
    files={selected ? [{ path: selected.path, relativePath: selected.name }] : []}
    activePath={selectedPath ?? null} onActivate={file => setSelectedPath(file.path)}
    onClose={() => setSelectedPath(undefined)} onOpenStart={() => setSelectedPath(undefined)}
    trailingActions={<>
      {selected && !selected.unavailable && <>
        <HeaderIconButton icon={<RefreshCw className="h-4 w-4" />} tooltip={t('conversationFiles.retry')} aria-label={t('conversationFiles.retry')} onClick={() => setRevision(value => value + 1)} />
        {!selected.readOnly && <HeaderIconButton icon={<ExternalLink className="h-4 w-4" />} tooltip={t('common.open')} aria-label={t('common.open')} onClick={() => { void window.electronAPI.openFile(selected.path) }} />}
        <HeaderIconButton icon={<FolderOpen className="h-4 w-4" />} tooltip={t('conversationFiles.reveal')} aria-label={t('conversationFiles.reveal')} onClick={() => reveal(selected.path)} />
      </>}
      <HeaderIconButton icon={<FolderOpen className="h-4 w-4" strokeWidth={1.7} />} tooltip={directoryLabel} aria-label={directoryLabel} aria-expanded={directoryVisible} data-state={directoryVisible ? 'open' : 'closed'} onClick={() => setDirectoryVisible(value => !value)} className="h-[26px] w-[26px] rounded-lg" />
      {onClose && <HeaderIconButton icon={<PanelRightClose className="h-4 w-4" />} tooltip={t('conversationFiles.collapse')} aria-label={t('conversationFiles.collapse')} aria-expanded onClick={onClose} className="h-[26px] w-[26px] rounded-lg" />}
    </>}
  />

  return (
    <section data-testid="conversation-files" data-session-id={sessionId} aria-label={t('conversationFiles.title')} className="h-full min-h-0 bg-background">
      <WorkspaceDockLayout header={header} directory={directoryVisible && !loading && !error ? directory : undefined}
        directoryWidth={WORKSPACE_DIRECTORY_DEFAULT_WIDTH} directoryLabel={t('writing.directory.title')} compact={compact}>
        <div data-testid="conversation-preview" className="h-full min-h-0">
          {error ? <div role="alert" className="px-3 py-2 text-sm text-destructive">
            <p>{t('conversationFiles.loadFailed')}</p><p className="break-words">{error}</p>
            <Button variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>{t('conversationFiles.retry')}</Button>
          </div> : loading ? <div role="status" className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">{t('conversationFiles.loading')}</div>
            : selectedPath && (!selected || selected.unavailable) ? <div role="status" className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">{t('conversationFiles.missing')}</div>
            : selected ? <FileViewer key={`${selected.path}:${selected.modifiedAt}:${selected.size}:${revision}`} path={selected.path}
                externalPreviewHint={selected.readOnly ? t('conversationFiles.unsupported') : undefined} />
            : <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">{t(empty ? 'conversationFiles.empty' : 'conversationFiles.select')}</div>}
        </div>
      </WorkspaceDockLayout>
    </section>
  )
}
