/**
 * MainContentPanel - Right panel component for displaying content
 *
 * input: Navigation state, workspace-scoped session metadata, primary writing-content readiness, narrow action contexts, and entity selection atoms
 * output: Independently loaded writing chat plus content panels for sources, skills, settings, and automations
 * pos: Renderer content router inside the app-shell panel stack
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 *
 * The NavigationState is the single source of truth for what to display.
 *
 * In focused mode (single window), wraps content with StoplightProvider
 * so PanelHeader components automatically compensate for macOS traffic lights.
 *
 * When multiple sessions are selected (multi-select mode), shows the
 * MultiSelectPanel with batch action buttons instead of a single chat.
 */

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation, Trans } from 'react-i18next'
import { Panel } from './Panel'
import { PanelHeader } from './PanelHeader'
import { MultiSelectPanel } from './MultiSelectPanel'
import { useSessionBatchActions, useSessionPanelChrome } from '@/context/AppShellContext'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { workspacePanelFieldsAtomFamily, hasOtherWorkspacesAtom, sessionIdsAtom, sessionMetaAtomFamily, sessionMetaMapAtom, windowWorkspaceIdAtom, windowWorkspacesAtom, type SessionMeta } from '@/atoms/sessions'
import { StoplightProvider } from '@/context/StoplightContext'
import {
  useNavigationState,
  useNavigationActions,
  isWritingNavigation,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
} from '@/contexts/NavigationContext'
import { useSessionSelection, useIsMultiSelectActive, useSelectedIds, useSelectedSessionMetas, useSelectionCount } from '@/hooks/useSession'
import { routes } from '@/lib/navigate'
import { sourceSelection, automationSelection } from '@/hooks/useEntitySelection'
import { extractLabelId } from '@craft-agent/shared/labels'
import type { SessionStatusId } from '@/config/session-status-config'
import SourceInfoPage from '@/pages/SourceInfoPage'
import SkillInfoPage from '@/pages/SkillInfoPage'
import SkillsHubPage from '@/pages/SkillsHubPage'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'
import { AutomationInfoPage } from '../automations/AutomationInfoPage'
import type { ExecutionEntry } from '../automations/types'
import { automationsAtom } from '@/atoms/automations'
import { useAutomationActions } from '@/hooks/useAutomations'
import { SendResourceToWorkspaceDialog, type SendResourceType } from './SendResourceToWorkspaceDialog'
import { resolveWritingSessionId } from './writing-session-selection'

const LazyChatPage = React.lazy(() => import('@/pages/ChatPage'))

/**
 * Writing keeps its chat visible by default, but transcript work must not compete
 * with the directory and first document that make the project usable.
 */
export const WritingPrimaryContentReadyContext = React.createContext(true)

export interface MainContentPanelProps {
  /** Whether both sidebar and navigator are hidden by responsive compaction. */
  isSidebarAndNavigatorHidden?: boolean
  /** Optional className for the container */
  className?: string
  /**
   * Override the navigation state for this panel.
   * When provided, this panel renders based on the override instead of the global NavigationState.
   * Used by PanelSlot to render panels in the panel stack.
   */
  navStateOverride?: import('../../../shared/types').NavigationState | null
}

export function MainContentPanel({
  isSidebarAndNavigatorHidden = false,
  className,
  navStateOverride,
}: MainContentPanelProps) {
  const { t } = useTranslation()
  const globalNavState = useNavigationState()
  const navState = navStateOverride ?? globalNavState
  const isMultiSelectActive = useIsMultiSelectActive()
  const activeWorkspaceId = useAtomValue(windowWorkspaceIdAtom)
  const hasOtherWorkspaces = useAtomValue(hasOtherWorkspacesAtom)
  const activeWorkspace = useAtomValue(workspacePanelFieldsAtomFamily(activeWorkspaceId ?? null))
  const automations = useAtomValue(automationsAtom)
  const {
    automationTestResults,
    getAutomationHistory,
    handleDeleteAutomation,
    handleDuplicateAutomation,
    handleReplayAutomation,
    handleTestAutomation,
    handleToggleAutomation,
    automationPendingDelete,
    confirmDeleteAutomation,
    pendingDeleteAutomation,
    setAutomationPendingDelete,
  } = useAutomationActions(activeWorkspaceId, automations)

  // Execution history for the selected automation
  const selectedAutomationId = isAutomationsNavigation(navState) ? navState.details?.automationId : undefined
  const [executionHistory, setExecutionHistory] = useState<{
    automationId: string
    entries: ExecutionEntry[]
  } | null>(null)

  useEffect(() => {
    if (!selectedAutomationId) return
    let stale = false

    // Initial fetch
    getAutomationHistory(selectedAutomationId).then(entries => {
      if (!stale) setExecutionHistory({ automationId: selectedAutomationId, entries })
    })

    // Re-fetch on automation changes (live updates when automations fire)
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      if (!stale) {
        getAutomationHistory(selectedAutomationId).then(entries => {
          if (!stale) setExecutionHistory({ automationId: selectedAutomationId, entries })
        })
      }
    })

    return () => { stale = true; cleanup() }
  }, [selectedAutomationId, getAutomationHistory])

  const executions = executionHistory && executionHistory.automationId === selectedAutomationId
    ? executionHistory.entries
    : []

  // Source multi-select state
  const isSourceMultiSelectActive = sourceSelection.useIsMultiSelectActive()
  const sourceSelectionCount = sourceSelection.useSelectionCount()
  const selectedSourceIds = sourceSelection.useSelectedIds()
  const { clearMultiSelect: clearSourceSelection } = sourceSelection.useSelection()

  // Automation multi-select state
  const isAutomationMultiSelectActive = automationSelection.useIsMultiSelectActive()
  const automationSelectionCount = automationSelection.useSelectionCount()
  const selectedAutomationIds = automationSelection.useSelectedIds()
  const { clearMultiSelect: clearAutomationSelection } = automationSelection.useSelection()

  // Send to Workspace dialog state (shared across resource types)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceType, setSendResourceType] = useState<SendResourceType>('source')
  const [sendResourceIds, setSendResourceIds] = useState<string[]>([])
  const [sendResourceLabel, setSendResourceLabel] = useState('')
  const remoteWorkspaceId = activeWorkspace?.remoteWorkspaceId

  const openSendDialog = useCallback((type: SendResourceType, ids: Set<string>) => {
    const count = ids.size
    setSendResourceType(type)
    setSendResourceIds([...ids])
    setSendResourceLabel(`${count} ${type}${count !== 1 ? 's' : ''}`)
    setSendDialogOpen(true)
  }, [])

  // Wrap content with StoplightProvider so PanelHeaders auto-compensate in focused mode.
  // Also renders the Send to Workspace dialog (portal-based, so it overlays regardless of position).
  const wrapWithStoplight = (content: React.ReactNode) => (
    <StoplightProvider value={isSidebarAndNavigatorHidden}>
      {content}
      {sendDialogOpen ? (
        <SendResourceWorkspaceDialogHost
          open={sendDialogOpen}
          onOpenChange={setSendDialogOpen}
          resourceType={sendResourceType}
          resourceIds={sendResourceIds}
          resourceLabel={sendResourceLabel}
          activeWorkspaceId={activeWorkspaceId || ''}
        />
      ) : null}
      <Dialog open={!!automationPendingDelete} onOpenChange={(open) => { if (!open) setAutomationPendingDelete(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('dialog.deleteAutomation.title')}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="dialog.deleteAutomation.description"
                values={{ name: pendingDeleteAutomation?.name }}
                components={{ strong: <strong /> }}
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutomationPendingDelete(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={confirmDeleteAutomation}>{t('common.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StoplightProvider>
  )

  // Settings navigator - uses component map from settings-pages.ts
  if (isSettingsNavigation(navState)) {
    const SettingsPageComponent = getSettingsPageComponent(navState.subpage)
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <SettingsPageComponent />
      </Panel>
    )
  }

  // Sources navigator - show source info, multi-select panel, or empty state
  if (isSourcesNavigation(navState)) {
    if (isSourceMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={sourceSelectionCount}
            entityType="source"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('source', selectedSourceIds) : undefined}
            onClearSelection={clearSourceSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SourceInfoPage
            sourceSlug={navState.details.sourceSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No source selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("sourcesList.noSourcesConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Skills uses one full-width native Hub with a dedicated detail route.
  if (isSkillsNavigation(navState)) {
    if (navState.details?.type === 'skill') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
            workspaceRootPath={activeWorkspace?.rootPath ?? ''}
            canRevealLocally={!activeWorkspace?.remoteWorkspaceId}
          />
        </Panel>
      )
    }
    // The bare Skills route is the native discovery and management surface.
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <SkillsHubPage />
      </Panel>
    )
  }

  // Automations navigator - show automation info, multi-select panel, or empty state
  if (isAutomationsNavigation(navState)) {
    if (isAutomationMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={automationSelectionCount}
            entityType="automation"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('automation', selectedAutomationIds) : undefined}
            onClearSelection={clearAutomationSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      const automation = automations.find(h => h.id === navState.details!.automationId)
      if (automation) {
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AutomationInfoPage
              automation={automation}
              executions={executions}
              testResult={automationTestResults?.[automation.id]}
              onTest={() => handleTestAutomation(automation.id)}
              onToggleEnabled={() => handleToggleAutomation(automation.id)}
              onDuplicate={() => handleDuplicateAutomation(automation.id)}
              onDelete={() => handleDeleteAutomation(automation.id)}
              onReplay={handleReplayAutomation}
              workspaceRootPath={activeWorkspace?.rootPath}
            />
          </Panel>
        )
      }
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("automations.noAutomationsConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Writing owns the default chat surface. Session metadata may arrive after
  // the file workspace, so this child activates ChatPage independently.
  if (isWritingNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <WritingSessionContent
          activeWorkspaceId={activeWorkspaceId}
          remoteWorkspaceId={remoteWorkspaceId}
        />
      </Panel>
    )
  }

  // Session routes reuse the same chat surface for history/deep links.
  if (isSessionsNavigation(navState)) {
    // Multi-select mode: show batch actions panel
    if (isMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SessionBatchActionsPanel />
        </Panel>
      )
    }

    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SessionRouteContent
            sessionId={navState.details.sessionId}
            activeWorkspaceId={activeWorkspaceId}
            remoteWorkspaceId={remoteWorkspaceId}
          />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("session.selectConversation")}</p>
        </div>
      </Panel>
    )
  }

  // Fallback (should not happen with proper NavigationState)
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("session.selectConversation")}</p>
      </div>
    </Panel>
  )
}

function WritingSessionContent({
  activeWorkspaceId,
  remoteWorkspaceId,
}: {
  activeWorkspaceId?: string | null
  remoteWorkspaceId?: string | null
}) {
  const sessionIds = useAtomValue(sessionIdsAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { state, select } = useSessionSelection()
  const primaryContentReady = React.useContext(WritingPrimaryContentReadyContext)
  const [deferredSessionId, setDeferredSessionId] = useState<string | null>(null)
  const [activatedWorkspaceId, setActivatedWorkspaceId] = useState<string | null>(null)
  const workspaceId = activeWorkspaceId ?? remoteWorkspaceId ?? null

  const defaultSessionId = useMemo(() => {
    return resolveWritingSessionId({
      sessionIds,
      sessionMetaMap,
      selectedSessionId: state.selected,
      activeWorkspaceId,
      remoteWorkspaceId,
    })
  }, [activeWorkspaceId, remoteWorkspaceId, sessionIds, sessionMetaMap, state.selected])

  // AppShell supplies a deterministic readiness signal after the directory and
  // selected document commit. Once activated, chat remains mounted while the
  // user switches files; only a project switch closes the latch.
  useEffect(() => {
    if (!defaultSessionId) {
      React.startTransition(() => {
        setDeferredSessionId(null)
        setActivatedWorkspaceId(null)
      })
      return
    }
    if (!primaryContentReady) return

    React.startTransition(() => {
      setDeferredSessionId(defaultSessionId)
      setActivatedWorkspaceId(workspaceId)
      if (state.selected !== defaultSessionId) {
        select(defaultSessionId, sessionIds.indexOf(defaultSessionId))
      }
    })
  }, [defaultSessionId, primaryContentReady, select, sessionIds, state.selected, workspaceId])

  if (!deferredSessionId || activatedWorkspaceId !== workspaceId) {
    return <ChatPanelPlaceholder empty={sessionIds.length === 0} />
  }

  return (
    <SessionRouteContent
      sessionId={deferredSessionId}
      activeWorkspaceId={activeWorkspaceId}
      remoteWorkspaceId={remoteWorkspaceId}
    />
  )
}

function ChatPanelPlaceholder({ empty = false }: { empty?: boolean }) {
  const { t } = useTranslation()
  const { navigate } = useNavigationActions()
  const { rightSidebarButton } = useSessionPanelChrome()

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="writing-chat-placeholder">
      <PanelHeader
        className="border-b-0"
        title={t('chat.session')}
        rightSidebarButton={rightSidebarButton}
        actions={(
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => navigate(routes.action.newSession())}
          >
            {t('session.newSession')}
          </Button>
        )}
      />
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        {empty ? <p className="text-sm">{t('session.noSessionsYet')}</p> : null}
      </div>
    </div>
  )
}

function SendResourceWorkspaceDialogHost({
  open,
  onOpenChange,
  resourceType,
  resourceIds,
  resourceLabel,
  activeWorkspaceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceType: SendResourceType
  resourceIds: string[]
  resourceLabel: string
  activeWorkspaceId: string
}) {
  const workspaces = useAtomValue(windowWorkspacesAtom)

  return (
    <SendResourceToWorkspaceDialog
      open={open}
      onOpenChange={onOpenChange}
      resourceType={resourceType}
      resourceIds={resourceIds}
      resourceLabel={resourceLabel}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
    />
  )
}

function SessionBatchActionsPanel() {
  const {
    onSessionStatusChange,
    onArchiveSession,
    onSessionLabelsChange,
    sessionStatuses,
    labels,
  } = useSessionBatchActions()
  const selectedIds = useSelectedIds()
  const selectedMetas = useSelectedSessionMetas()
  const selectionCount = useSelectionCount()
  const { clearMultiSelect } = useSessionSelection()

  const activeStatusId = useMemo((): SessionStatusId | null => {
    if (selectedMetas.length === 0) return null
    const first = (selectedMetas[0].sessionStatus || 'todo') as SessionStatusId
    const allSame = selectedMetas.every(meta => (meta.sessionStatus || 'todo') === first)
    return allSame ? first : null
  }, [selectedMetas])

  const appliedLabelIds = useMemo(() => {
    if (selectedMetas.length === 0) return new Set<string>()
    const toLabelSet = (meta: SessionMeta) =>
      new Set((meta.labels || []).map(entry => extractLabelId(entry)))
    const [first, ...rest] = selectedMetas.map(toLabelSet)
    const intersection = new Set(first)
    for (const labelSet of rest) {
      for (const id of [...intersection]) {
        if (!labelSet.has(id)) intersection.delete(id)
      }
    }
    return intersection
  }, [selectedMetas])

  const handleBatchSetStatus = useCallback((status: SessionStatusId) => {
    selectedIds.forEach(sessionId => {
      onSessionStatusChange(sessionId, status)
    })
  }, [selectedIds, onSessionStatusChange])

  const handleBatchArchive = useCallback(() => {
    selectedIds.forEach(sessionId => {
      onArchiveSession(sessionId)
    })
    clearMultiSelect()
  }, [selectedIds, onArchiveSession, clearMultiSelect])

  const handleBatchToggleLabel = useCallback((labelId: string) => {
    if (!onSessionLabelsChange) return
    const allHaveLabel = selectedMetas.every(meta =>
      (meta.labels || []).some(entry => extractLabelId(entry) === labelId)
    )

    selectedMetas.forEach(meta => {
      const labels = meta.labels || []
      const hasLabel = labels.some(entry => extractLabelId(entry) === labelId)
      const filtered = labels.filter(entry => extractLabelId(entry) !== labelId)
      const nextLabels = allHaveLabel
        ? filtered
        : (hasLabel ? labels : [...labels, labelId])
      onSessionLabelsChange(meta.id, nextLabels)
    })
  }, [selectedMetas, onSessionLabelsChange])

  return (
    <MultiSelectPanel
      count={selectionCount}
      sessionStatuses={sessionStatuses}
      activeStatusId={activeStatusId}
      onSetStatus={handleBatchSetStatus}
      labels={labels}
      appliedLabelIds={appliedLabelIds}
      onToggleLabel={handleBatchToggleLabel}
      onArchive={handleBatchArchive}
      onClearSelection={clearMultiSelect}
    />
  )
}

function SessionRouteContent({
  sessionId,
  activeWorkspaceId,
  remoteWorkspaceId,
}: {
  sessionId: string
  activeWorkspaceId?: string | null
  remoteWorkspaceId?: string | null
}) {
  const { t } = useTranslation()
  const selectedSessionMeta = useAtomValue(sessionMetaAtomFamily(sessionId))
  const selectedSessionMatchesWorkspace = !activeWorkspaceId || (
    selectedSessionMeta?.workspaceId === activeWorkspaceId
    || (!!remoteWorkspaceId && selectedSessionMeta?.workspaceId === remoteWorkspaceId)
  )

  if (!selectedSessionMatchesWorkspace) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("session.noSessionSelected")}</p>
      </div>
    )
  }

  return (
    <React.Suspense fallback={<ChatPanelPlaceholder />}>
      <LazyChatPage sessionId={sessionId} />
    </React.Suspense>
  )
}
