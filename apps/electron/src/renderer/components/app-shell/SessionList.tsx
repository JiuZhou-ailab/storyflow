import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useAtomValue, useSetAtom } from "jotai"
import { isToday, isYesterday, format } from "date-fns"
import { getDateLocale } from "@craft-agent/shared/i18n"
import { useAction, useActionLabel } from "@/actions"
import { Inbox, Archive } from "lucide-react"

import { getSessionStatus } from "@/utils/session"
import * as storage from "@/lib/local-storage"
import { KEYS } from "@/lib/local-storage"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { extractLabelId, flattenLabels, getDescendantIds } from "@craft-agent/shared/labels"
import * as MultiSelect from "@/hooks/useMultiSelect"
import { Spinner } from "@craft-agent/ui"
import { EntityListEmptyScreen } from "@/components/ui/entity-list-empty"
import { EntityList, type EntityListGroup } from "@/components/ui/entity-list"
import { RenameDialog } from "@/components/ui/rename-dialog"
import { SessionSearchHeader } from "./SessionSearchHeader"
import { SessionItem } from "./SessionItem"
import { SessionListProvider, type SessionListContextValue } from "@/context/SessionListContext"
import { useSessionSelection, useSessionSelectionStore } from "@/hooks/useSession"
import { getSessionDateGroupKey, useSessionSearch, type FilterMode } from "@/hooks/useSessionSearch"
import { useSessionActions } from "@/hooks/useSessionActions"
import { useEntityListInteractions } from "@/hooks/useEntityListInteractions"
import { useFocusZone } from "@/hooks/keyboard"
import { useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useNavigationActions, useNavigationState, routes, isSessionsNavigation } from "@/contexts/NavigationContext"
import { useFocusActions } from "@/context/FocusContext"
import { sendToWorkspaceAtom, sessionMetaMapAtom, type SessionMeta } from "@/atoms/sessions"
import type { ViewConfig } from "@craft-agent/shared/views"
import type { SessionStatusId, SessionStatus } from "@/config/session-status-config"
import { buildCollapsedGroupsScopeSuffix } from "@/utils/session-list-collapse"

export interface SessionListRow {
  item: SessionMeta
}

/** Grouping mode for chat list */
export type ChatGroupingMode = 'date' | 'status' | 'unread'

interface SessionListProps {
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onSessionStatusChange: (sessionId: string, state: SessionStatusId) => void
  onRename: (sessionId: string, name: string) => void
  /** Called when Enter is pressed to focus chat input for a specific session */
  onFocusChatInput?: (sessionId?: string) => void
  /** Called when user wants to open a session in a new window */
  onOpenInNewWindow?: (session: SessionMeta) => void
  /** Called to navigate to a specific view (e.g., 'allSessions', 'flagged') */
  onNavigateToView?: (view: 'allSessions' | 'flagged') => void
  /** Whether search mode is active */
  searchActive?: boolean
  /** Current search query */
  searchQuery?: string
  /** Called when search query changes */
  onSearchChange?: (query: string) => void
  /** Called when search is closed */
  onSearchClose?: () => void
  /** Dynamic todo states from workspace config */
  sessionStatuses?: SessionStatus[]
  /** View evaluator — evaluates a session and returns matching view configs */
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  /** Label configs for resolving session label IDs to display info */
  labels?: LabelConfig[]
  /** Callback when session labels are toggled (for labels submenu in SessionMenu) */
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  /** How to group sessions: 'date' (default) or 'status' */
  groupingMode?: ChatGroupingMode
  /** Workspace ID for content search (optional - if not provided, content search is disabled) */
  workspaceId?: string
  /** Remote workspace ID for mirrored sessions. */
  remoteWorkspaceId?: string | null
  /** Secondary status filter (status chips in "All Sessions" view) - for search result grouping */
  statusFilter?: Map<string, FilterMode>
  /** Secondary label filter (label chips) - for search result grouping */
  labelFilterMap?: Map<string, FilterMode>
  /** Override which session is highlighted (for multi-panel focused panel tracking) */
  focusedSessionId?: string | null
  /** Override navigation target (for multi-panel: focuses existing panel or navigates focused panel) */
  onNavigateToSession?: (sessionId: string) => void
  /** DOM-verified match info for the active session (from ChatDisplay) */
  activeChatMatchInfo?: { sessionId: string | null; count: number; isHighlighting?: boolean }
  /** Whether any workspace can receive a send-to-workspace action. */
  hasRemoteWorkspaces?: boolean
  /** Whether the shell is in compact mode. */
  isCompactMode?: boolean
}

// Re-export SessionStatusId for use by parent components
export type { SessionStatusId }

// Note: uses date-fns format for non-today/yesterday dates; Today/Yesterday translated at render time
function formatDateGroupLabel(date: Date, t: (key: string) => string, lang: string): string {
  if (isToday(date)) return t('common.today')
  if (isYesterday(date)) return t('common.yesterday')
  return format(date, 'MMM d', { locale: getDateLocale(lang) })
}

/**
 * SessionList - Scrollable list of session cards with keyboard navigation
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate and select sessions (immediate selection)
 * - Arrow Left/Right: Navigate between zones
 * - Enter: Focus chat input
 * - Home/End: Jump to first/last session
 */
export function SessionList({
  onDelete,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onSessionStatusChange,
  onRename,
  onFocusChatInput,
  onOpenInNewWindow,
  searchActive,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  sessionStatuses = [],
  evaluateViews,
  labels = [],
  onLabelsChange,
  groupingMode = 'date',
  workspaceId,
  remoteWorkspaceId,
  statusFilter,
  labelFilterMap,
  focusedSessionId,
  onNavigateToSession,
  activeChatMatchInfo,
  hasRemoteWorkspaces = false,
  isCompactMode = false,
}: SessionListProps) {
  const { t, i18n } = useTranslation()
  const setSendToWorkspace = useSetAtom(sendToWorkspaceAtom)
  const { hotkey: nextSearchMatchHotkey } = useActionLabel('chat.nextSearchMatch')
  const { hotkey: prevSearchMatchHotkey } = useActionLabel('chat.prevSearchMatch')

  // --- Selection (atom-backed, shared with ChatDisplay + BatchActionPanel) ---
  const {
    select: selectSession,
    toggle: toggleSession,
    selectRange,
    isMultiSelectActive,
  } = useSessionSelection()
  const selectionStore = useSessionSelectionStore()

  const { navigate, navigateToSession: navigateToSessionPrimary } = useNavigationActions()
  const navigateToSession = onNavigateToSession ?? navigateToSessionPrimary
  const navState = useNavigationState()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { showEscapeOverlay } = useEscapeInterrupt()

  // Pre-flatten label tree once for efficient ID lookups in each SessionItem
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])
  const labelById = useMemo(() => new Map(flatLabels.map(label => [label.id, label])), [flatLabels])
  const descendantLabelIdsById = useMemo(
    () => new Map(flatLabels.map(label => [label.id, getDescendantIds(labels, label.id)])),
    [flatLabels, labels]
  )
  const getDescendantLabelIds = useCallback(
    (labelId: string) => descendantLabelIdsById.get(labelId) ?? [],
    [descendantLabelIdsById]
  )

  // Get current filter from navigation state (for preserving context in tab routes)
  const currentFilter = isSessionsNavigation(navState) ? navState.filter : undefined

  const workspaceItems = useMemo(() => {
    const result: SessionMeta[] = []
    for (const meta of sessionMetaMap.values()) {
      if (meta.hidden) continue
      if (
        workspaceId &&
        meta.workspaceId !== workspaceId &&
        (!remoteWorkspaceId || meta.workspaceId !== remoteWorkspaceId)
      ) {
        continue
      }
      result.push(meta)
    }
    return result
  }, [remoteWorkspaceId, sessionMetaMap, workspaceId])

  const filteredItems = useMemo(() => {
    const sessionFilter = currentFilter ?? null
    if (!sessionFilter) return []

    const activeItems: SessionMeta[] = []
    const archivedItems: SessionMeta[] = []
    for (const item of workspaceItems) {
      if (item.isArchived) archivedItems.push(item)
      else activeItems.push(item)
    }

    let result: SessionMeta[]
    switch (sessionFilter.kind) {
      case 'allSessions':
        result = activeItems
        break
      case 'flagged':
        result = activeItems.filter(item => item.isFlagged)
        break
      case 'archived':
        result = archivedItems
        break
      case 'state':
        result = activeItems.filter(item => (item.sessionStatus || 'todo') === sessionFilter.stateId)
        break
      case 'label': {
        if (sessionFilter.labelId === '__all__') {
          result = activeItems.filter(item => item.labels && item.labels.length > 0)
        } else {
          const matchIds = new Set([sessionFilter.labelId, ...getDescendantIds(labels, sessionFilter.labelId)])
          result = activeItems.filter(item => item.labels?.some(label => matchIds.has(extractLabelId(label))))
        }
        break
      }
      case 'view': {
        result = activeItems.filter(item => {
          const matched = evaluateViews?.(item) ?? []
          if (sessionFilter.viewId === '__all__') return matched.length > 0
          return matched.some(view => view.id === sessionFilter.viewId)
        })
        break
      }
      default:
        result = activeItems
    }

    if (statusFilter && statusFilter.size > 0) {
      const includes = new Set<SessionStatusId>()
      const excludes = new Set<SessionStatusId>()
      for (const [id, mode] of statusFilter) {
        if (mode === 'include') includes.add(id)
        else excludes.add(id)
      }
      if (includes.size > 0) {
        result = result.filter(item => includes.has((item.sessionStatus || 'todo') as SessionStatusId))
      }
      if (excludes.size > 0) {
        result = result.filter(item => !excludes.has((item.sessionStatus || 'todo') as SessionStatusId))
      }
    }

    if (labelFilterMap && labelFilterMap.size > 0) {
      const includes = new Set<string>()
      const excludes = new Set<string>()
      for (const [id, mode] of labelFilterMap) {
        const ids = [id, ...getDescendantIds(labels, id)]
        for (const expandedId of ids) {
          if (mode === 'include') includes.add(expandedId)
          else excludes.add(expandedId)
        }
      }
      if (includes.size > 0) {
        result = result.filter(item => item.labels?.some(label => includes.has(extractLabelId(label))))
      }
      if (excludes.size > 0) {
        result = result.filter(item => !item.labels?.some(label => excludes.has(extractLabelId(label))))
      }
    }

    return result
  }, [currentFilter, evaluateViews, labelFilterMap, labels, statusFilter, workspaceItems])

  const items = searchActive ? workspaceItems : filteredItems

  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  // Track if search input has actual DOM focus (for proper keyboard navigation gating)
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false)

  // Collapsed group keys (for collapsible group headers) — persisted per workspace/filter/grouping context
  const collapseScopeSuffix = useMemo(() => {
    return buildCollapsedGroupsScopeSuffix({
      workspaceId,
      currentFilter,
      groupingMode,
    })
  }, [
    workspaceId,
    groupingMode,
    currentFilter?.kind,
    currentFilter && 'stateId' in currentFilter ? currentFilter.stateId : undefined,
    currentFilter && 'labelId' in currentFilter ? currentFilter.labelId : undefined,
    currentFilter && 'viewId' in currentFilter ? currentFilter.viewId : undefined,
  ])

  const readCollapsedGroupsForScope = useCallback((scopeSuffix: string): Set<string> => {
    const scopedRaw = storage.getRaw(KEYS.collapsedSessionGroups, scopeSuffix)
    if (scopedRaw !== null) {
      try {
        const parsed = JSON.parse(scopedRaw)
        return new Set(Array.isArray(parsed) ? parsed : [])
      } catch {
        return new Set()
      }
    }

    // Legacy fallback: previous versions used a single global key with no scope suffix.
    // Use as migration source only when this scope has never been written.
    const legacy = storage.get<string[]>(KEYS.collapsedSessionGroups, [])
    return new Set(legacy)
  }, [])

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => readCollapsedGroupsForScope(collapseScopeSuffix))
  const collapseScopeRef = useRef(collapseScopeSuffix)

  useEffect(() => {
    if (collapseScopeRef.current === collapseScopeSuffix) return
    setCollapsedGroups(readCollapsedGroupsForScope(collapseScopeSuffix))
    collapseScopeRef.current = collapseScopeSuffix
  }, [collapseScopeSuffix, readCollapsedGroupsForScope])

  useEffect(() => {
    // Avoid writing stale groups from a previous scope during context switches.
    if (collapseScopeRef.current !== collapseScopeSuffix) return
    storage.set(KEYS.collapsedSessionGroups, Array.from(collapsedGroups), collapseScopeSuffix)
  }, [collapsedGroups, collapseScopeSuffix])

  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  // --- Data pipeline (search, filtering, pagination, grouping) ---
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  const {
    isSearchMode,
    highlightQuery,
    isSearchingContent,
    isSearchUnavailable,
    contentSearchResults,
    matchingFilterItems,
    otherResultItems,
    exceededSearchLimit,
    flatItems,
    hasMore,
    collapsedGroupsMeta,
    searchInputRef,
  } = useSessionSearch({
    items,
    searchActive: searchActive ?? false,
    searchQuery,
    workspaceId,
    currentFilter,
    evaluateViews,
    statusFilter,
    labelFilterMap,
    getDescendantLabelIds,
    collapsedGroups,
    groupingMode,
    scrollViewportRef,
  })

  const rowData = useMemo(() => {
    if (isSearchMode) {
      const matchingRows: SessionListRow[] = matchingFilterItems.map(item => ({ item }))
      const otherRows: SessionListRow[] = otherResultItems.map(item => ({ item }))

      const groups: EntityListGroup<SessionListRow>[] = []
      if (matchingRows.length > 0) {
        groups.push({ key: 'matching', label: t("session.inCurrentView"), items: matchingRows })
      }
      if (otherRows.length > 0) {
        groups.push({ key: 'other', label: t("session.otherConversations"), items: otherRows })
      }

      return {
        rows: [...matchingRows, ...otherRows],
        groups,
      }
    }

    // flatItems only contains visible (expanded + paginated) items.
    // collapsedGroupsMeta provides key + count for collapsed groups so we
    // can insert header-only placeholder groups in the correct position.
    const rows: SessionListRow[] = flatItems.map(item => ({ item }))

    if (groupingMode === 'unread') {
      // Two fixed buckets: unread on top, read below. Within each, items keep
      // the same `lastMessageAt`-descending order they already arrive in.
      // Both buckets always render — even when empty — so the user can see at
      // a glance which mode they're in. The header shows a count, so an empty
      // bucket is unambiguous (e.g. "Unread (0)").
      const unreadRows: SessionListRow[] = []
      const readRows: SessionListRow[] = []
      for (const row of rows) {
        if (row.item.hasUnread) unreadRows.push(row)
        else readRows.push(row)
      }

      const collapsedUnread = collapsedGroupsMeta.find(m => m.key === 'unread-yes')
      const collapsedRead = collapsedGroupsMeta.find(m => m.key === 'unread-no')

      // For collapsed groups prefer the persisted count (matches how the
      // date/status branches surface the size of a collapsed bucket).
      const unreadCount = collapsedUnread ? collapsedUnread.count : unreadRows.length
      const readCount = collapsedRead ? collapsedRead.count : readRows.length

      const orderedGroups: EntityListGroup<SessionListRow>[] = [
        {
          key: 'unread-yes',
          label: t('session.unreadGroup', { count: unreadCount }),
          items: unreadRows,
          // Empty groups have nothing to collapse into; suppress the caret.
          collapsible: unreadRows.length > 0 || !!collapsedUnread,
          ...(collapsedUnread ? { collapsedCount: collapsedUnread.count } : {}),
        },
        {
          key: 'unread-no',
          label: t('session.readGroup', { count: readCount }),
          items: readRows,
          collapsible: readRows.length > 0 || !!collapsedRead,
          ...(collapsedRead ? { collapsedCount: collapsedRead.count } : {}),
        },
      ]

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    if (groupingMode === 'status') {
      const statusOrder = new Map<string, number>()
      sessionStatuses.forEach((state, index) => statusOrder.set(state.id, index))
      const statusById = new Map(sessionStatuses.map(state => [state.id, state]))
      const collapsedMetaByKey = new Map(collapsedGroupsMeta.map(meta => [meta.key, meta]))

      // Build groups from visible items
      const groupsByKey = new Map<string, { rows: SessionListRow[], statusId: string }>()
      for (const row of rows) {
        const statusId = getSessionStatus(row.item)
        const key = `status-${statusId}`
        if (!groupsByKey.has(key)) groupsByKey.set(key, { rows: [], statusId })
        groupsByKey.get(key)!.rows.push(row)
      }

      // Insert collapsed placeholder groups
      for (const meta of collapsedGroupsMeta) {
        if (!groupsByKey.has(meta.key)) {
          const statusId = meta.key.replace('status-', '')
          groupsByKey.set(meta.key, { rows: [], statusId })
        }
      }

      const orderedGroups: EntityListGroup<SessionListRow>[] = []
      for (const [key, { rows: groupRows, statusId }] of groupsByKey) {
        const state = statusById.get(statusId)
        if (!state) continue
        const collapsedMeta = collapsedMetaByKey.get(key)
        orderedGroups.push({
          key,
          label: t(`status.${state.id}`, state.label),
          items: groupRows,
          collapsible: true,
          ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
        })
      }
      orderedGroups.sort((a, b) => {
        const aOrder = statusOrder.get(a.key.replace('status-', '')) ?? 999
        const bOrder = statusOrder.get(b.key.replace('status-', '')) ?? 999
        return aOrder - bOrder
      })

      // If only one group exists, disable collapsing — there's nothing to collapse into
      if (orderedGroups.length === 1) {
        orderedGroups[0].collapsible = false
      }

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    // Default: group by date
    const groupsByKey = new Map<string, EntityListGroup<SessionListRow>>()
    const groupDates = new Map<string, Date>()

    for (const row of rows) {
      const groupKey = getSessionDateGroupKey(row.item)

      if (!groupsByKey.has(groupKey)) {
        const day = new Date(groupKey)
        groupsByKey.set(groupKey, {
          key: groupKey,
          label: formatDateGroupLabel(day, t, i18n.resolvedLanguage ?? 'en'),
          items: [],
          collapsible: true,
        })
        groupDates.set(groupKey, day)
      }
      groupsByKey.get(groupKey)!.items.push(row)
    }

    // Insert collapsed placeholder groups (header-only, items: [])
    for (const meta of collapsedGroupsMeta) {
      if (!groupsByKey.has(meta.key)) {
        const date = new Date(meta.key)
        groupsByKey.set(meta.key, {
          key: meta.key,
          label: formatDateGroupLabel(date, t, i18n.resolvedLanguage ?? 'en'),
          items: [],
          collapsible: true,
          collapsedCount: meta.count,
        })
        groupDates.set(meta.key, date)
      }
    }

    // Sort all groups by date descending
    const orderedKeys = Array.from(groupDates.entries())
      .sort(([, a], [, b]) => b.getTime() - a.getTime())
      .map(([key]) => key)

    const orderedGroups = orderedKeys.map(key => groupsByKey.get(key)!)

    // If only one group exists, disable collapsing — there's nothing to collapse into
    if (orderedGroups.length === 1) {
      orderedGroups[0].collapsible = false
    }

    return {
      rows,
      groups: orderedGroups,
    }
  }, [isSearchMode, matchingFilterItems, otherResultItems, flatItems, groupingMode, sessionStatuses, collapsedGroupsMeta, t])

  const flatRows = rowData.rows

  const collapseAllGroups = useCallback(() => {
    if (groupingMode === 'status') {
      const allKeys = new Set(items.map(item => `status-${getSessionStatus(item)}`))
      setCollapsedGroups(allKeys)
    } else if (groupingMode === 'unread') {
      const allKeys = new Set(items.map(item => item.hasUnread ? 'unread-yes' : 'unread-no'))
      setCollapsedGroups(allKeys)
    } else {
      const allKeys = new Set(items.map(getSessionDateGroupKey))
      setCollapsedGroups(allKeys)
    }
  }, [items, groupingMode])
  const expandAllGroups = useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  const rowIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatRows.forEach((row, index) => {
      map.set(row.item.id, index)
    })
    return map
  }, [flatRows])

  // --- Action handlers with toast feedback ---
  const {
    handleFlagWithToast,
    handleUnflagWithToast,
    handleArchiveWithToast,
    handleUnarchiveWithToast,
    handleDeleteWithToast,
  } = useSessionActions({ onFlag, onUnflag, onArchive, onUnarchive, onDelete })

  // --- Focus zone ---
  const { focusZone } = useFocusActions()
  const { zoneRef, isFocused, shouldMoveDOMFocus } = useFocusZone({ zoneId: 'navigator' })

  // Keyboard eligibility: zone-focused OR search input focused (for arrow navigation)
  const isKeyboardEligible = isFocused || (searchActive && isSearchInputFocused)
  const getSessionRowId = useCallback((row: SessionListRow) => row.item.id, [])

  // --- Interactions (keyboard navigation + selection via shared atom) ---
  const interactions = useEntityListInteractions<SessionListRow>({
    items: flatRows,
    getId: getSessionRowId,
    keyboard: {
      onNavigate: useCallback((row: SessionListRow) => {
        navigateToSession(row.item.id)
      }, [navigateToSession]),
      onActivate: useCallback((row: SessionListRow) => {
        // Only navigate when not in multi-select (matches original behavior)
        if (!MultiSelect.isMultiSelectActive(selectionStore.state)) {
          navigateToSession(row.item.id)
        }
        onFocusChatInput?.(row.item.id)
      }, [selectionStore.state, navigateToSession, onFocusChatInput]),
      enabled: isKeyboardEligible,
      virtualFocus: searchActive ?? false,
    },
    multiSelect: true,
    selectionStore,
    selectedIdOverride: focusedSessionId,
  })
  const { activeIndex, setActiveIndex } = interactions.keyboard

  // Sync activeIndex when selection changes externally (e.g. from ChatDisplay)
  useEffect(() => {
    const selectedSessionId = selectionStore.state.selected
    if (!selectedSessionId) return
    const selectedRowIndex = rowIndexMap.get(selectedSessionId)
    if (selectedRowIndex !== undefined && selectedRowIndex !== activeIndex) {
      setActiveIndex(selectedRowIndex)
    }
  }, [selectionStore.state.selected, rowIndexMap, activeIndex, setActiveIndex])

  // Focus active item when zone gains keyboard focus
  useEffect(() => {
    if (shouldMoveDOMFocus && flatRows.length > 0 && !(searchActive ?? false)) {
      interactions.keyboard.focusActiveItem()
    }
  }, [shouldMoveDOMFocus, flatRows.length, searchActive, interactions.keyboard])

  // --- Global keyboard shortcuts ---
  const isFocusWithinZone = () => zoneRef.current?.contains(document.activeElement) ?? false

  useAction('navigator.selectAll', () => {
    interactions.selection.selectAll()
  }, {
    enabled: isFocusWithinZone,
  }, [interactions.selection])

  useAction('navigator.clearSelection', () => {
    const selectedId = selectionStore.state.selected
    interactions.selection.clear()
    if (selectedId) navigateToSession(selectedId)
  }, {
    enabled: () => isMultiSelectActive && !showEscapeOverlay,
  }, [isMultiSelectActive, showEscapeOverlay, interactions.selection, selectionStore.state.selected, navigateToSession])

  // --- Click handlers ---
  const handleSelectSession = useCallback((row: SessionListRow, index: number) => {
    selectSession(row.item.id, index)
    navigateToSession(row.item.id)
  }, [selectSession, navigateToSession])

  const handleSelectSessionById = useCallback((sessionId: string) => {
    const index = rowIndexMap.get(sessionId) ?? -1
    if (index >= 0) {
      selectSession(sessionId, index)
    } else {
      selectSession(sessionId, 0)
    }
    navigateToSession(sessionId)
  }, [rowIndexMap, selectSession, navigateToSession])

  const handleToggleSelect = useCallback((row: SessionListRow, index: number) => {
    focusZone('navigator', { intent: 'click', moveFocus: false })
    toggleSession(row.item.id, index)
  }, [focusZone, toggleSession])

  const handleRangeSelect = useCallback((toIndex: number) => {
    focusZone('navigator', { intent: 'click', moveFocus: false })
    const allIds = flatRows.map(row => row.item.id)
    selectRange(toIndex, allIds)
  }, [focusZone, flatRows, selectRange])

  // Arrow key shortcuts for zone navigation (left → sidebar, right → chat)
  const handleKeyDown = useCallback((e: React.KeyboardEvent, _item: SessionMeta) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusZone('sidebar', { intent: 'keyboard' })
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusZone('chat', { intent: 'keyboard' })
      return
    }
  }, [focusZone])

  // --- Rename dialog ---
  const handleRenameClick = useCallback((sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId)
    setRenameName(currentName)
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }, [])

  const handleRenameSubmit = () => {
    if (renameSessionId && renameName.trim()) {
      onRename(renameSessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameSessionId(null)
    setRenameName("")
  }

  // --- Search input key handler ---
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      searchInputRef.current?.blur()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      onFocusChatInput?.(selectionStore.state.selected ?? undefined)
      return
    }
    // Forward arrow keys via interactions
    interactions.searchInputProps.onKeyDown(e)
  }, [searchInputRef, onFocusChatInput, interactions.searchInputProps, selectionStore.state.selected])

  // --- Context value (shared across all SessionItems) ---
  const handleFocusZone = useCallback(() => focusZone('navigator', { intent: 'click', moveFocus: false }), [focusZone])
  const handleOpenInNewWindow = useCallback((item: SessionMeta) => onOpenInNewWindow?.(item), [onOpenInNewWindow])
  const resolvedSearchQuery = isSearchMode ? highlightQuery : searchQuery

  const listContext = useMemo((): SessionListContextValue => ({
    onRenameClick: handleRenameClick,
    onSessionStatusChange,
    onFlag: onFlag ? handleFlagWithToast : undefined,
    onUnflag: onUnflag ? handleUnflagWithToast : undefined,
    onArchive: onArchive ? handleArchiveWithToast : undefined,
    onUnarchive: onUnarchive ? handleUnarchiveWithToast : undefined,
    onMarkUnread,
    onDelete: handleDeleteWithToast,
    onLabelsChange,
    onSelectSessionById: handleSelectSessionById,
    onOpenInNewWindow: handleOpenInNewWindow,
    onSendToWorkspace: (ids: string[]) => setSendToWorkspace(ids),
    onFocusZone: handleFocusZone,
    onKeyDown: handleKeyDown,
    sessionStatuses,
    flatLabels,
    labelById,
    labels,
    isMultiSelectActive,
    isCompactMode,
    hasRemoteWorkspaces,
  }), [
    handleRenameClick, onSessionStatusChange,
    onFlag, handleFlagWithToast, onUnflag, handleUnflagWithToast,
    onArchive, handleArchiveWithToast, onUnarchive, handleUnarchiveWithToast,
    onMarkUnread, handleDeleteWithToast, onLabelsChange,
    handleSelectSessionById, handleOpenInNewWindow, setSendToWorkspace, handleFocusZone, handleKeyDown,
    sessionStatuses, flatLabels, labelById, labels,
    isMultiSelectActive,
    isCompactMode, hasRemoteWorkspaces,
  ])

  // --- Empty state (non-search) — render before EntityList ---
  // Don't show empty state when there are collapsed groups with content
  if (flatRows.length === 0 && rowData.groups.length === 0 && !searchActive) {
    if (currentFilter?.kind === 'archived') {
      return (
        <EntityListEmptyScreen
          icon={<Archive />}
          title={t("session.noArchivedSessions")}
          description={t("session.noArchivedSessionsDesc")}
          className="h-full"
        />
      )
    }

    return (
      <EntityListEmptyScreen
        icon={<Inbox />}
        title={t("session.noSessionsYet")}
        description={t("session.noSessionsYetDesc")}
        className="h-full"
      >
        <button
          onClick={() => {
            const params: { status?: string; label?: string } = {}
            if (currentFilter?.kind === 'state') params.status = currentFilter.stateId
            else if (currentFilter?.kind === 'label') params.label = currentFilter.labelId
            navigate(routes.action.newSession(Object.keys(params).length > 0 ? params : undefined))
          }}
          className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
        >
          {t("session.newSession")}
        </button>
      </EntityListEmptyScreen>
    )
  }

  // --- Render ---
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SessionListProvider value={listContext}>
      <EntityList<SessionListRow>
        groups={rowData.groups}
        getKey={(row) => row.item.id}
        renderItem={(row, _indexInGroup, isFirstInGroup) => {
          const flatIndex = rowIndexMap.get(row.item.id) ?? 0
          const rowProps = interactions.getRowProps(row, flatIndex)
          const activeMatchCount = rowProps.isSelected && activeChatMatchInfo?.sessionId === row.item.id
            ? activeChatMatchInfo.count
            : undefined
          const chatMatchCount = activeMatchCount ?? contentSearchResults.get(row.item.id)?.matchCount
          return (
            <SessionItem
              item={row.item}
              index={flatIndex}
              itemProps={rowProps.buttonProps as Record<string, unknown>}
              isSelected={rowProps.isSelected}
              isFirstInGroup={isFirstInGroup}
              isInMultiSelect={rowProps.isInMultiSelect ?? false}
              onSelect={() => handleSelectSession(row, flatIndex)}
              onToggleSelect={() => handleToggleSelect(row, flatIndex)}
              onRangeSelect={() => handleRangeSelect(flatIndex)}
              searchQuery={resolvedSearchQuery}
              chatMatchCount={chatMatchCount}
              nextSearchMatchHotkey={nextSearchMatchHotkey}
              prevSearchMatchHotkey={prevSearchMatchHotkey}
            />
          )
        }}
        header={
          <>
            {searchActive && (
              <SessionSearchHeader
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                onSearchClose={onSearchClose}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setIsSearchInputFocused(true)}
                onBlur={() => setIsSearchInputFocused(false)}
                isSearching={isSearchingContent}
                isUnavailable={isSearchUnavailable}
                resultCount={matchingFilterItems.length + otherResultItems.length}
                exceededLimit={exceededSearchLimit}
                inputRef={searchInputRef}
              />
            )}
            {isSearchMode && matchingFilterItems.length === 0 && otherResultItems.length > 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                {t("session.noResultsInFilter")}
              </div>
            )}
          </>
        }
        emptyState={
          isSearchMode && !isSearchingContent ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <p className="text-sm text-muted-foreground">{t("session.noSessionsFound")}</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                {t("session.noSessionsFoundDesc")}
              </p>
              <button
                onClick={() => onSearchChange?.('')}
                className="text-xs text-foreground hover:underline mt-2"
              >
                {t("session.clearSearch")}
              </button>
            </div>
          ) : undefined
        }
        footer={
          hasMore ? (
            <div className="flex justify-center py-4">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : undefined
        }
        viewportRef={scrollViewportRef}
        containerRef={zoneRef}
        containerProps={{
          'data-focus-zone': 'navigator',
          role: 'listbox',
          'aria-label': 'Sessions',
        }}
        scrollAreaClassName="select-none mask-fade-top-short"
        collapsedGroups={collapsedGroups}
        onToggleCollapse={toggleGroupCollapse}
        onCollapseAll={collapseAllGroups}
        onExpandAll={expandAllGroups}
      />
      </SessionListProvider>

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={t("session.renameSession")}
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder={t("session.enterSessionName")}
      />
    </div>
  )
}
