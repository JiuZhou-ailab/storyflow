// input: Active conversation identity, optional file-open intent and session file RPC/events
// output: Session-owned file groups and a single read-only preview with live refresh
// pos: Shared conversation content surface for the desktop dock and compact info drawer

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FolderOpen, PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react'
import type { ConversationFile, ConversationFiles } from '../../../shared/types'
import { FileViewer } from '../files/FileViewer'
import { HeaderIconButton } from '../ui/HeaderIconButton'
import { FileTreeItem } from './SessionFilesSection'
import { ResizableColumn } from '../app-shell/ResizableColumn'
import { PANEL_MIN_WIDTH } from '../app-shell/panel-constants'
import { toast } from 'sonner'

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
  const [width, setWidth] = React.useState(560)
  const owner = React.useMemo(() => ({}), [sessionId, active, compact])
  const [requested, setRequested] = React.useState<{ owner: object; path: string } | null>(null)
  const current = React.useRef({ owner, sessionId, active, compact, onOpenFile, t })
  current.current = { owner, sessionId, active, compact, onOpenFile, t }
  const openRequest = React.useRef(0)
  const stopResize = React.useRef<(() => void) | undefined>(undefined)
  React.useEffect(() => () => { stopResize.current?.(); openRequest.current += 1 }, [])
  React.useEffect(() => { stopResize.current?.() }, [sessionId, active, compact])
  const maxWidth = Math.max(280, availableWidth - PANEL_MIN_WIDTH)
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
      const move = (next: MouseEvent) => setWidth(Math.min(maxWidth, Math.max(280, shownWidth + startX - next.clientX)))
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
  const [expanded, setExpanded] = React.useState(new Set<string>())
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
  const select = (file: ConversationFile) => { if (file.type === 'file') setSelectedPath(file.path) }
  const reveal = (path: string) => { void window.electronAPI.showInFolder(path) }
  const toggleFolder = (path: string) => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const empty = !loading && !error && content.groups.length === 0

  return (
    <section data-testid="conversation-files" data-session-id={sessionId} className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 px-3">
        <span className="text-sm font-medium">{t('conversationFiles.title')}</span>
        {onClose && <HeaderIconButton icon={<PanelRightClose className="h-4 w-4" />} tooltip={t('conversationFiles.collapse')} aria-label={t('conversationFiles.collapse')} aria-expanded onClick={onClose} />}
      </header>
      {error ? <div role="alert" className="p-4 text-sm">
        <p>{t('conversationFiles.loadFailed')}</p><p className="break-words text-muted-foreground">{error}</p>
        <button className="mt-2 underline" onClick={() => setRetry(value => value + 1)}>{t('conversationFiles.retry')}</button>
      </div> : loading ? <p role="status" className="p-4 text-sm text-muted-foreground">{t('conversationFiles.loading')}</p> : (
        <div className={`flex min-h-0 flex-1 ${compact ? 'flex-col' : ''}`}>
          <nav aria-label={t('conversationFiles.title')} className={compact ? 'max-h-44 shrink-0 overflow-auto border-b p-2' : 'w-44 shrink-0 overflow-auto border-r border-border/50 p-2'}>
            {content.groups.map(group => <div key={group.kind} className="mb-3">
              <h3 className="px-2 py-2 text-xs text-muted-foreground">{t(`conversationFiles.groups.${group.kind}`)}</h3>
              {group.files.map(file => <FileTreeItem key={file.path} file={file} depth={0} expandedPaths={expanded}
                onToggleExpand={toggleFolder} onFileClick={select} onFileDoubleClick={select} onRevealInFileManager={reveal} />)}
            </div>)}
            {content.truncated && <p role="status" className="p-2 text-xs text-muted-foreground">{t('conversationFiles.truncated')}</p>}
          </nav>
          <div data-testid="conversation-preview" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selectedPath && (!selected || selected.unavailable) ? <p role="status" className="p-4 text-sm">{t('conversationFiles.missing')}</p>
              : selected ? <>
                <div className="flex shrink-0 items-center justify-between px-3 py-1 text-xs text-muted-foreground">
                  <span>{t('conversationFiles.readOnly')}</span>
                  <div className="flex items-center gap-3">
                    <button aria-label={t('conversationFiles.retry')} title={t('conversationFiles.retry')} onClick={() => setRevision(value => value + 1)}><RefreshCw className="h-4 w-4" /></button>
                    {!selected.readOnly && <button aria-label={t('common.open')} title={t('common.open')} onClick={() => { void window.electronAPI.openFile(selected.path) }}><ExternalLink className="h-4 w-4" /></button>}
                    <button aria-label={t('conversationFiles.reveal')} title={t('conversationFiles.reveal')} onClick={() => reveal(selected.path)}><FolderOpen className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <FileViewer key={`${selected.path}:${selected.modifiedAt}:${selected.size}:${revision}`} path={selected.path}
                    externalPreviewHint={selected.readOnly ? t('conversationFiles.unsupported') : undefined} />
                </div>
              </> : <p className="p-4 text-sm text-muted-foreground">{t(empty ? 'conversationFiles.empty' : 'conversationFiles.select')}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
