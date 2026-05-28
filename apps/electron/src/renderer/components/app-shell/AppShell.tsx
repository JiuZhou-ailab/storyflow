// input: Workspace/session state, navigation state, and shell callbacks
// output: Desktop app shell with sidebar, navigator, and main content panels
// pos: Top-level renderer layout coordinator for workspace navigation

import * as React from "react"
import { useTranslation, Trans } from "react-i18next"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useAtomValue, useStore } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import {
  Settings,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  RotateCw,
  Flag,
  ListFilter,
  Tag,
  Check,
  X,
  Search,
  Plus,
  Trash2,
  DatabaseZap,
  Zap,
  Inbox,
  Cake,
  Calendar,
  Palette,
  Layers,
  ListTodo,
  Info,
  MailOpen,
  BookOpenText,
  FileText,
  History,
  Library,
  MapPinned,
  ScrollText,
  UsersRound,
  Download,
  FileUp,
} from "lucide-react"
// SessionStatusIcons no longer used - icons come from dynamic sessionStatuses
import { SourceAvatar } from "@/components/ui/source-avatar"
import { TopBar } from "./TopBar"
import { GlobalSearchDialog } from "./GlobalSearchDialog"
import { McpIcon } from "../icons/McpIcon"
import { cn } from "@/lib/utils"
import { isMac } from "@/lib/platform"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import type { MentionFileReference } from "@/components/ui/mention-menu"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent, DocumentFormattedMarkdownOverlay } from "@craft-agent/ui"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from "@/components/ui/styled-dropdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FadingText } from "@/components/ui/fading-text"
import {
  Collapsible,
  CollapsibleTrigger,
  AnimatedCollapsibleContent,
  springTransition as collapsibleSpring,
} from "@/components/ui/collapsible"
import { SessionList, type ChatGroupingMode } from "./SessionList"
import { MainContentPanel } from "./MainContentPanel"
import { PanelStackContainer } from "./PanelStackContainer"
import type { ChatDisplayHandle } from "./ChatDisplay"
import { NovelDocumentEditorPanel, type NovelSelectionAiRequest } from "@/components/writing/NovelDocumentEditorPanel"
import { NovelExportDialog } from "@/components/writing/NovelExportDialog"
import { NovelVersionHistoryDialog } from "@/components/writing/NovelVersionHistoryDialog"
import { formatNovelWorkspaceFileTitle } from "@/components/writing/novel-file-display"
import { LeftSidebar, type LinkItem as LeftSidebarLinkItem, type SidebarItem as LeftSidebarItem } from "./LeftSidebar"
import { useSession } from "@/hooks/useSession"
import { AppShellProvider, type AppShellContextType } from "@/context/AppShellContext"
import { EscapeInterruptProvider, useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useTheme } from "@/context/ThemeContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useAction } from "@/actions"
import { useFocusZone } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import { useSetAtom } from "jotai"
import type { Session, Workspace, FileAttachment, PermissionRequest, LoadedSource, LoadedSkill, PermissionMode, SourceFilter, AutomationFilter, WorkspaceVersionEntry, WorkspaceVersionFileChange } from "../../../shared/types"
import { ensureSessionMessagesLoadedAtom, sessionAtomFamily, sessionMetaMapAtom, sendToWorkspaceAtom, type SessionMeta } from "@/atoms/sessions"
import { sourcesAtom } from "@/atoms/sources"
import { skillsAtom } from "@/atoms/skills"
import { panelStackAtom, panelCountAtom, focusedPanelIdAtom, focusedSessionIdAtom, focusNextPanelAtom, focusPrevPanelAtom, parseSessionIdFromRoute } from "@/atoms/panel-stack"
import { type SessionStatusId, type SessionStatus, statusConfigsToSessionStatuses } from "@/config/session-status-config"
import { useStatuses } from "@/hooks/useStatuses"
import { useLabels } from "@/hooks/useLabels"
import { useViews } from "@/hooks/useViews"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { LabelIcon } from "@/components/ui/label-icon"
import { filterSessionStatuses as filterLabelMenuStates } from "@/components/ui/label-menu"
import { createLabelMenuItems, filterItems as filterLabelMenuItems, type LabelMenuItem } from "@/components/ui/label-menu-utils"
import { getDescendantIds, getLabelDisplayName, extractLabelId, findLabelById, sortLabelsForDisplay } from "@craft-agent/shared/labels"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { resolveEntityColor } from "@craft-agent/shared/colors"
import * as storage from "@/lib/local-storage"
import { toast } from "sonner"
import { navigate, routes } from "@/lib/navigate"
import {
  useNavigation,
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  type NavigationState,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SourcesListPanel } from "./SourcesListPanel"
import { SkillsListPanel } from "./SkillsListPanel"
import { AutomationsListPanel } from "../automations/AutomationsListPanel"
import { AUTOMATION_TYPE_TO_FILTER_KIND } from "../automations/types"
import { useAutomations } from "@/hooks/useAutomations"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { PanelHeader } from "./PanelHeader"
import { SendToWorkspaceDialog } from "./SendToWorkspaceDialog"
import { MessagingDialogHost } from "@/components/messaging/MessagingDialogHost"
import { EditPopover, getEditConfig, type EditContextKey } from "@/components/ui/EditPopover"
import SettingsNavigator from "@/pages/settings/SettingsNavigator"
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
  PANEL_MIN_WIDTH,
  RADIUS_EDGE,
  RADIUS_INNER,
} from "./panel-constants"
import {
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_WORKSPACE_WIDTH,
  getNavigatorResizeMaxWidth,
  isUserConfiguredShellLayoutWidth,
  resolveInitialShellLayoutWidths,
  shouldResolveInitialShellLayoutWidths,
} from "./layout-defaults"
import { getPrimarySidebarLinks } from "./primary-sidebar-links"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { clearSourceIconCaches } from "@/lib/icon-cache"
import { dispatchFocusInputEvent } from "./input/focus-input-events"
import { collectFileChangesFromActivities } from "@/lib/file-changes"
import { buildRejectedFileContent } from "@/lib/file-change-review"
import {
  buildMergedManuscriptContent,
  buildNovelExportPlan,
  createNovelExportFolderName,
  type NovelExportOptions,
} from "@/lib/novel-export"
import {
  getAdjacentChangedFilePath,
  getNovelReviewChangeKey,
  getPendingChangedFilePaths,
  getPendingChangesForFile,
  normalizeNovelFileChangePaths,
  parseNovelReviewStatusMap,
  type NovelReviewStatusMap,
} from "@/lib/novel-review-workflow"
import {
  buildAcceptNovelChangeUndoEntry,
  buildRejectNovelChangeUndoEntry,
  type NovelReviewUndoEntry,
} from "@/lib/novel-review-undo"
import {
  buildNovelWorkspaceTree,
  detectNovelProjectFromSearchResults,
  getNovelImportTargetRelativePath,
  getShortFormGlobalInfoFiles,
  getNovelWorkspaceRelativePath,
  getNovelWorkspaceCandidateRoots,
  isShortFormNovelWorkspaceFiles,
  mapSearchResultsToNovelWorkspaceFiles,
  NOVEL_WORKSPACE_CATALOG_DIRECTORY_QUERIES,
  NOVEL_WORKSPACE_DETECTION_QUERIES,
  normalizeNovelCreateFilePath,
  selectDefaultNovelFile,
  type NovelCreateFileBasePath,
  type NovelWorkspaceFile,
  type NovelWorkspaceFileSectionId,
} from "@/lib/writing-workspace"
import { groupMessagesByTurn, type FileChange } from "@craft-agent/ui"
import { RPC_CHANNELS, type FileSearchBatchRequest, type FileSearchBatchResult } from "@craft-agent/shared/protocol"

/**
 * AppShellProps - Minimal props interface for AppShell component
 *
 * Data and callbacks come via contextValue (AppShellContextType).
 * Only UI-specific state is passed as separate props.
 *
 * Adding new features:
 * 1. Add to AppShellContextType in context/AppShellContext.tsx
 * 2. Update App.tsx to include in contextValue
 * 3. Use via useAppShellContext() hook in child components
 */
interface AppShellProps {
  /** All data and callbacks - passed directly to AppShellProvider */
  contextValue: AppShellContextType
  /** UI-specific props */
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  menuNewChatTrigger?: number
  /** Focused mode - hides sidebars, shows only the chat content */
  isFocusedMode?: boolean
}

function isNovelReviewUndoShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey)
    && !event.shiftKey
    && !event.altKey
    && event.key.toLowerCase() === 'z'
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  const tagName = target.tagName.toLowerCase()
  return tagName === 'input'
    || tagName === 'textarea'
    || target.isContentEditable
    || target.closest('[contenteditable="true"]') != null
}

/** Filter mode for tri-state filtering: include shows only matching, exclude hides matching */
type FilterMode = 'include' | 'exclude'

interface NovelCreateFileTarget {
  basePath: NovelCreateFileBasePath
  title: string
  placeholder: string
  initialValue: string
}

interface NovelWorkspaceBriefPreparation {
  shouldSend: boolean
  brief?: string
}

const altClickTooltipLabel = isMac ? '⌥ click to exclude' : 'Alt click to exclude'
const SESSION_LIST_MIN_WIDTH = 240
const SESSION_LIST_MAX_WIDTH = 480
const NOVEL_WORKSPACE_NAVIGATOR_MIN_WIDTH = 420
const NOVEL_WORKSPACE_NAVIGATOR_DEFAULT_WIDTH = DEFAULT_WORKSPACE_WIDTH
const NAVIGATOR_SASH_HIT_WIDTH = 14
const NAVIGATOR_SASH_FLEX_MARGIN = -(PANEL_GAP / 2)
const NAVIGATOR_SASH_CAPTURE_HALF_WIDTH = 18
const NOVEL_AUTO_VERSION_CHAR_THRESHOLD = 100
const NOVEL_AUTO_VERSION_INTERVAL_MS = 5 * 60 * 1000
const NOVEL_WORKSPACE_BRIEF_CHANGE_LIMIT = 20

function joinWorkspacePath(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/[\\/]+$/, '')
  const relative = relativePath.replace(/^[\\/]+/, '')
  return relative ? `${root}/${relative}` : root
}

function mergeOneTimeContext(existing: string | undefined, addition: string | undefined): string | undefined {
  const next = addition?.trim()
  if (!next) return existing
  const current = existing?.trim()
  return current ? `${current}\n\n${next}` : next
}

function getKnownWorkspaceCommit(rootPath: string, sessionId: string): string | undefined {
  const commits = storage.get<Record<string, string>>(storage.KEYS.workspaceVersionKnownCommit, {}, rootPath)
  return commits[sessionId]
}

function setKnownWorkspaceCommit(rootPath: string, sessionId: string, commitHash: string): void {
  const commits = storage.get<Record<string, string>>(storage.KEYS.workspaceVersionKnownCommit, {}, rootPath)
  storage.set(storage.KEYS.workspaceVersionKnownCommit, {
    ...commits,
    [sessionId]: commitHash,
  }, rootPath)
}

function formatWorkspaceChange(change: WorkspaceVersionFileChange): string {
  if (change.status === 'renamed' && change.previousPath) {
    return `${change.previousPath} -> ${change.path} renamed`
  }
  return `${change.path} ${change.status}`
}

function buildNovelWorkspaceFreshnessBrief(
  changes: WorkspaceVersionFileChange[],
  activeFile?: string | null,
): string | undefined {
  if (changes.length === 0) return undefined

  const visibleChanges = changes.slice(0, NOVEL_WORKSPACE_BRIEF_CHANGE_LIMIT)
  const overflow = changes.length - visibleChanges.length
  const lines = [
    '<workspace-brief>',
    'Workspace files changed since your last known checkpoint in this session.',
    activeFile ? `Active writing file: ${activeFile}` : undefined,
    '',
    'Unknown changes:',
    ...visibleChanges.map(change => `- ${formatWorkspaceChange(change)}`),
    overflow > 0 ? `- ...and ${overflow} more file(s)` : undefined,
    '',
    'Before editing these files, read the latest content first.',
    '</workspace-brief>',
  ].filter((line): line is string => line !== undefined)

  return lines.join('\n')
}

function collectAgentTouchedRelativePaths(
  changes: FileChange[],
  rootPath: string,
  files: Pick<NovelWorkspaceFile, 'path' | 'relativePath'>[],
): string[] {
  const relativeByAbsolutePath = new Map(files.map(file => [file.path, file.relativePath]))
  return [...new Set(changes
    .filter(change => !change.error)
    .map(change => relativeByAbsolutePath.get(change.filePath) ?? getNovelWorkspaceRelativePath(change.filePath, rootPath))
    .filter(Boolean))]
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    operation.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

async function searchNovelWorkspaceFiles(
  rootPath: string,
  requests: FileSearchBatchRequest[]
): Promise<FileSearchBatchResult[]> {
  const canUseBatchSearch = typeof window.electronAPI.searchFilesBatch === 'function'
    && window.electronAPI.isChannelAvailable(RPC_CHANNELS.fs.SEARCH_BATCH)

  if (canUseBatchSearch) {
    try {
      return await withTimeout(
        window.electronAPI.searchFilesBatch(rootPath, requests),
        2500
      )
    } catch (error) {
      console.warn('[AppShell] Falling back to single file searches:', error)
    }
  }

  return Promise.all(
    requests.map(async (request) => {
      try {
        return {
          query: request.query,
          results: await withTimeout(
            window.electronAPI.searchFiles(rootPath, request.query, request.options),
            1000
          ),
        }
      } catch {
        return {
          query: request.query,
          results: [],
        }
      }
    })
  )
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

function getContentChangeSize(previous: string, next: string): number {
  if (previous === next) return 0

  let prefixLength = 0
  const minLength = Math.min(previous.length, next.length)
  while (prefixLength < minLength && previous[prefixLength] === next[prefixLength]) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength < minLength - prefixLength
    && previous[previous.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  const previousChanged = previous.length - prefixLength - suffixLength
  const nextChanged = next.length - prefixLength - suffixLength
  return Math.max(previousChanged, nextChanged)
}

/** Wraps children in a Tooltip that shows instantly on hover — only rendered when `show` is true. */
function AltExcludeTooltip({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return children
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="text-xs">{altClickTooltipLabel}</TooltipContent>
    </Tooltip>
  )
}

function NovelWorkspaceUtilityTopNav({
  links,
  getItemProps,
  focusedItemId,
}: {
  links: LeftSidebarItem[]
  getItemProps?: (id: string) => {
    tabIndex: number
    'data-focused': boolean
    ref: (el: HTMLElement | null) => void
  }
  focusedItemId?: string | null
}) {
  const items = links.filter((item): item is LeftSidebarLinkItem => !('type' in item))
  if (items.length === 0) return null

  return (
    <nav className="shrink-0" aria-label="Workspace tools">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {items.map((item) => {
          const itemProps = getItemProps?.(item.id)
          const isFocused = focusedItemId === item.id
          return (
            <button
              key={item.id}
              {...(() => {
                const { ref: _ref, ...rest } = itemProps || { ref: undefined }
                return rest
              })()}
              ref={(el) => itemProps?.ref(el)}
              type="button"
              title={item.tooltip ?? item.title}
              data-focused={isFocused || undefined}
              onClick={item.onClick}
              className={cn(
                'flex h-[28px] min-w-0 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-xs outline-none transition-colors',
                'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                item.variant === 'default'
                  ? 'bg-foreground/[0.08] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
              )}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
                {renderNovelUtilityIcon(item.icon)}
              </span>
              <span className="truncate">{item.title}</span>
              {item.label ? (
                <span className="ml-0.5 rounded-[4px] bg-foreground/[0.06] px-1 text-[10px] text-muted-foreground">
                  {item.label}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function renderNovelUtilityIcon(icon: LeftSidebarLinkItem['icon']) {
  const isComponent = typeof icon === 'function' ||
    (typeof icon === 'object' && icon !== null && 'render' in icon)

  if (isComponent) {
    const Icon = icon as React.ComponentType<{ className?: string }>
    return <Icon className="h-3.5 w-3.5" />
  }

  return icon
}

/**
 * FilterModeBadge - Display-only badge showing the current filter mode.
 * Shows a checkmark for 'include' and an X for 'exclude'. Used as a visual
 * indicator inside DropdownMenuSubTrigger rows (the actual mode switching
 * happens via the sub-menu content, not this badge).
 */
function FilterModeBadge({ mode }: { mode: FilterMode }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center h-5 w-5 rounded-[4px] -mr-1",
        mode === 'include'
          ? "bg-background text-foreground shadow-minimal"
          : "bg-destructive/10 text-destructive shadow-tinted",
      )}
      style={mode === 'exclude' ? { '--shadow-color': 'var(--destructive-rgb)' } as React.CSSProperties : undefined}
    >
      {mode === 'include' ? <Check className="!h-2.5 !w-2.5" /> : <X className="!h-2.5 !w-2.5" />}
    </span>
  )
}

/**
 * FilterModeSubMenuItems - Shared sub-menu content for switching filter mode.
 * Renders Include / Exclude / Remove options using StyledDropdownMenuItem for
 * consistent styling. Used inside StyledDropdownMenuSubContent by both leaf
 * and group label items when they have an active filter mode.
 */
function FilterModeSubMenuItems({
  mode,
  onChangeMode,
  onRemove,
}: {
  mode: FilterMode
  onChangeMode: (mode: FilterMode) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('include') }}
        className={cn(mode === 'include' && "bg-foreground/[0.03]")}
      >
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("filter.include")}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('exclude') }}
        className={cn(mode === 'exclude' && "bg-foreground/[0.03]")}
      >
        <X className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("filter.exclude")}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator />
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onRemove() }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("common.clear")}</span>
      </StyledDropdownMenuItem>
    </>
  )
}

/**
 * FilterMenuRow - Consistent layout for filter menu items.
 * Enforces: [icon 14px box] [label flex] [accessory 12px box]
 */
function FilterMenuRow({
  icon,
  label,
  accessory,
  iconClassName,
  iconStyle,
  noIconContainer,
}: {
  icon: React.ReactNode
  label: React.ReactNode
  accessory?: React.ReactNode
  /** Additional classes for icon container (e.g., for status icon scaling) */
  iconClassName?: string
  /** Style for icon container (e.g., for status icon color) */
  iconStyle?: React.CSSProperties
  /** When true, skip the icon container (for icons that have their own container) */
  noIconContainer?: boolean
}) {
  return (
    <>
      {noIconContainer ? (
        // Wrapper for color inheritance. Clone icon to add bare prop (removes EntityIcon container).
        <span style={iconStyle}>
          {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true }) : icon}
        </span>
      ) : (
        <span
          className={cn("h-3.5 w-3.5 flex items-center justify-center shrink-0", iconClassName)}
          style={iconStyle}
        >
          {icon}
        </span>
      )}
      <span className="flex-1">{label}</span>
      <span className="shrink-0">{accessory}</span>
    </>
  )
}

/**
 * FilterLabelItems - Recursive component for rendering label tree in the filter dropdown.
 *
 * Rendering rules by label state:
 * - **Inactive leaf**: StyledDropdownMenuItem — click to add as 'include'
 * - **Active leaf**: DropdownMenuSub — SubTrigger shows label + mode badge, SubContent
 *   has Include/Exclude/Remove options (uses Radix's built-in safe-triangle hover)
 * - **Group (with children)**: Always a DropdownMenuSub. When active, SubContent shows
 *   mode options first, then separator, then children. When inactive, shows a self-toggle
 *   item, then separator, then children.
 * - **Pinned labels**: Shown with a check mark, non-interactive (no toggle/sub-menu).
 */
function FilterLabelItems({
  labels,
  labelFilter,
  setLabelFilter,
  pinnedLabelId,
  altHeld,
}: {
  labels: LabelConfig[]
  labelFilter: Map<string, FilterMode>
  setLabelFilter: (updater: Map<string, FilterMode> | ((prev: Map<string, FilterMode>) => Map<string, FilterMode>)) => void
  /** Label ID pinned by the current route (non-removable, shown as checked+disabled) */
  pinnedLabelId?: string | null
  altHeld?: boolean
}) {
  /** Toggle a label filter: if active → remove, if inactive → add as 'include' (or 'exclude' with Alt) */
  const toggleLabel = (id: string, altKey = false) => {
    setLabelFilter(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, altKey ? 'exclude' : 'include')
      return next
    })
  }

  /** Build callbacks for changing/removing a label's filter mode */
  const makeModeCallbacks = (id: string) => ({
    onChangeMode: (newMode: FilterMode) => setLabelFilter(prev => {
      const next = new Map(prev)
      next.set(id, newMode)
      return next
    }),
    onRemove: () => setLabelFilter(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    }),
  })

  return (
    <>
      {labels.map(label => {
        const hasChildren = label.children && label.children.length > 0
        const isPinned = label.id === pinnedLabelId
        const mode = labelFilter.get(label.id)
        const isActive = !!mode && !isPinned

        // --- Group labels (have children) → always DropdownMenuSub ---
        if (hasChildren) {
          // Check if any child has an active filter (to show indicator on parent)
          const hasActiveChild = label.children!.some(child => {
            const childMode = labelFilter.get(child.id)
            return !!childMode && child.id !== pinnedLabelId
          })
          const showIndicator = isActive || hasActiveChild || isPinned

          return (
            <DropdownMenuSub key={label.id}>
              <StyledDropdownMenuSubTrigger>
                <FilterMenuRow
                  icon={<LabelIcon label={label} size="lg" hasChildren />}
                  label={label.name}
                  accessory={
                    showIndicator ? <Check className="h-3 w-3 text-muted-foreground" /> : undefined
                  }
                />
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent minWidth="min-w-[160px]">
                {isActive ? (
                  // Active group: group title as nested sub-trigger for mode options, then children
                  <>
                    <DropdownMenuSub>
                      {/* Click the group title to clear, hover to open mode submenu */}
                      <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); toggleLabel(label.id, e.altKey) }}>
                        <FilterMenuRow
                          icon={<LabelIcon label={label} size="lg" hasChildren />}
                          label={label.name}
                          accessory={<FilterModeBadge mode={mode} />}
                        />
                      </StyledDropdownMenuSubTrigger>
                      <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                        <FilterModeSubMenuItems mode={mode} {...makeModeCallbacks(label.id)} />
                      </StyledDropdownMenuSubContent>
                    </DropdownMenuSub>
                    <StyledDropdownMenuSeparator />
                    <FilterLabelItems
                      labels={label.children!}
                      labelFilter={labelFilter}
                      setLabelFilter={setLabelFilter}
                      pinnedLabelId={pinnedLabelId}
                      altHeld={altHeld}
                    />
                  </>
                ) : (
                  // Inactive group: self-toggle item, then children
                  <>
                    <AltExcludeTooltip show={!!altHeld && !isPinned}>
                      <StyledDropdownMenuItem
                        disabled={isPinned}
                        onClick={(e) => {
                          if (isPinned) return
                          e.preventDefault()
                          toggleLabel(label.id, e.altKey)
                        }}
                      >
                        <FilterMenuRow
                          icon={<LabelIcon label={label} size="lg" hasChildren />}
                          label={label.name}
                          accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : undefined}
                        />
                      </StyledDropdownMenuItem>
                    </AltExcludeTooltip>
                    <StyledDropdownMenuSeparator />
                    <FilterLabelItems
                      labels={label.children!}
                      labelFilter={labelFilter}
                      setLabelFilter={setLabelFilter}
                      pinnedLabelId={pinnedLabelId}
                      altHeld={altHeld}
                    />
                  </>
                )}
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
          )
        }

        // --- Active leaf label → DropdownMenuSub with mode options ---
        if (isActive) {
          return (
            <DropdownMenuSub key={label.id}>
              {/* Click the item itself to clear, hover to open mode submenu */}
              <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); toggleLabel(label.id, e.altKey) }}>
                <FilterMenuRow
                  icon={<LabelIcon label={label} size="lg" />}
                  label={label.name}
                  accessory={<FilterModeBadge mode={mode} />}
                />
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                <FilterModeSubMenuItems mode={mode} {...makeModeCallbacks(label.id)} />
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
          )
        }

        // --- Inactive / pinned leaf label → simple toggleable item ---
        return (
          <AltExcludeTooltip key={label.id} show={!!altHeld && !isPinned}>
            <StyledDropdownMenuItem
              disabled={isPinned}
              onClick={(e) => {
                if (isPinned) return
                e.preventDefault()
                toggleLabel(label.id, e.altKey)
              }}
            >
              <FilterMenuRow
                icon={<LabelIcon label={label} size="lg" />}
                label={label.name}
                accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : undefined}
              />
            </StyledDropdownMenuItem>
          </AltExcludeTooltip>
        )
      })}
    </>
  )
}


/**
 * AppShell - Main 3-panel layout container
 *
 * Layout: [LeftSidebar 20%] | [Workspace 50%] | [Assistant 30%]
 *
 * Session Filters:
 * - 'allSessions': Shows all sessions
 * - 'flagged': Shows flagged sessions
 * - 'state': Shows sessions with a specific todo state
 */
export function AppShell(props: AppShellProps) {
  // Wrap with EscapeInterruptProvider so AppShellContent can use useEscapeInterrupt
  return (
    <EscapeInterruptProvider>
      <AppShellContent {...props} />
    </EscapeInterruptProvider>
  )
}

/**
 * AppShellContent - Inner component that contains all the AppShell logic
 * Separated to allow useEscapeInterrupt hook to work (must be inside provider)
 */
function AppShellContent({
  contextValue,
  defaultLayout = [20, 32, 48],
  defaultCollapsed = false,
  menuNewChatTrigger,
  isFocusedMode = false,
}: AppShellProps) {
  // Destructure commonly used values from context
  // Note: sessions is NOT destructured here - we use sessionMetaMapAtom instead
  // to prevent closures from retaining the full messages array
  const {
    workspaces,
    activeWorkspaceId,
    sessionOptions,
    onSelectWorkspace,
    onWorkspaceCreated,
    onRefreshWorkspaces,
    onDeleteSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onMarkSessionRead,
    onMarkSessionUnread,
    onSessionStatusChange,
    onRenameSession,
    onOpenSettings,
    onOpenKeyboardShortcuts,
    onOpenStoredUserPreferences,
    onReset,
    onSendMessage,
    onOpenFile,
    onInputChange,
    getDraft,
    openNewChat,
    pendingPermissions,
  } = contextValue

  const { t } = useTranslation()

  // Get hotkey labels from centralized action registry

  const [isSidebarVisible, setIsSidebarVisible] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarVisible, !defaultCollapsed)
  })
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarWidth, DEFAULT_SIDEBAR_WIDTH)
  })
  // Session list width in pixels (min 240, max 480)
  const [sessionListWidth, setSessionListWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sessionListWidth, 300)
  })
  const [novelWorkspaceNavigatorWidth, setNovelWorkspaceNavigatorWidth] = React.useState(() => {
    return storage.get(storage.KEYS.novelWorkspaceNavigatorWidth, NOVEL_WORKSPACE_NAVIGATOR_DEFAULT_WIDTH)
  })
  const initialShellLayoutResolvedRef = React.useRef(false)

  // Hides both sidebar and navigator (CMD+. toggle)
  // Seed from either focused window param or persisted preference, then keep it toggleable.
  const [isSidebarAndNavigatorHidden, setIsSidebarAndNavigatorHidden] = React.useState(() => {
    return isFocusedMode || storage.get(storage.KEYS.focusModeEnabled, false)
  })

  // Auto-compact mode: shell width below mobile threshold hides sidebar/navigator
  // and switches to single-panel mode. Works in both webui (narrow viewport) and
  // desktop (narrow window or small screen).
  const shellRef = useRef<HTMLDivElement>(null)
  const shellWidth = useContainerWidth(shellRef)
  const MOBILE_THRESHOLD = 768
  const isAutoCompact = shellWidth > 0 && shellWidth < MOBILE_THRESHOLD

  const effectiveSidebarAndNavigatorHidden = isSidebarAndNavigatorHidden || isAutoCompact

  // What's New overlay
  const [showWhatsNew, setShowWhatsNew] = React.useState(false)
  const [releaseNotesContent, setReleaseNotesContent] = React.useState('')
  const [hasUnseenReleaseNotes, setHasUnseenReleaseNotes] = React.useState(false)

  // Check for unseen release notes on mount
  useEffect(() => {
    window.electronAPI.getLatestReleaseVersion().then((latestVersion) => {
      if (!latestVersion) return
      const lastSeen = storage.get(storage.KEYS.whatsNewLastSeenVersion, '')
      setHasUnseenReleaseNotes(lastSeen !== latestVersion)
    })
  }, [])

  const [isResizing, setIsResizing] = React.useState<'sidebar' | 'session-list' | 'novel-workspace-navigator' | null>(null)
  const [sidebarHandleY, setSidebarHandleY] = React.useState<number | null>(null)
  const [sessionListHandleY, setSessionListHandleY] = React.useState<number | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const sessionListHandleRef = React.useRef<HTMLDivElement>(null)
  const navigatorPanelRef = React.useRef<HTMLDivElement>(null)
  const latestSidebarWidthRef = React.useRef(sidebarWidth)
  const latestSessionListWidthRef = React.useRef(sessionListWidth)
  const latestNovelWorkspaceNavigatorWidthRef = React.useRef(novelWorkspaceNavigatorWidth)
  const [session, setSession] = useSession()
  const { resolvedMode, isDark, setMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward, navigateToSource, navigateToSession } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  // Derived from focused panel's route — all panels are peers
  const navState = useNavigationState()

  const store = useStore()
  const panelStack = useAtomValue(panelStackAtom)
  const panelCount = useAtomValue(panelCountAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)

  // Navigate the focused panel to a session.
  // If the session is already open in another panel, focus that panel instead.
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const navigateToSessionInPanel = useCallback((sessionId: string) => {
    // Check if the session is already open in any panel — focus it instead of navigating
    const stack = store.get(panelStackAtom)
    for (const entry of stack) {
      if (parseSessionIdFromRoute(entry.route) === sessionId) {
        setFocusedPanel(entry.id)
        return
      }
    }

    // Not open in any panel — navigate() updates the focused panel
    navigateToSession(sessionId)
  }, [store, setFocusedPanel, navigateToSession])

  const sessionsContext = React.useMemo(() => {
    if (isSessionsNavigation(navState)) {
      return {
        filter: navState.filter,
        sessionId: navState.details?.sessionId ?? null,
      }
    }
    return null
  }, [navState])

  const sessionFilter = sessionsContext?.filter ?? null

  // Derive source filter from navigation state (only when in sources navigator)
  const sourceFilter: SourceFilter | null = isSourcesNavigation(navState) ? navState.filter ?? null : null

  // Derive automation filter from navigation state (only when in automations navigator)
  const automationFilter: AutomationFilter | null = isAutomationsNavigation(navState) ? navState.filter ?? null : null

  // Per-view filter storage: each session list view (allSessions, flagged, state:X, label:X, view:X)
  // has its own independent set of status and label filters.
  // Each filter entry stores a mode ('include' or 'exclude') for tri-state filtering.
  type FilterEntry = Record<string, FilterMode> // id → mode
  type ViewFiltersMap = Record<string, { statuses: FilterEntry, labels: FilterEntry, groupingMode?: ChatGroupingMode }>

  // Compute a stable key for the current chat filter view
  const sessionFilterKey = useMemo(() => {
    if (!sessionFilter) return null
    switch (sessionFilter.kind) {
      case 'allSessions': return 'allSessions'
      case 'flagged': return 'flagged'
      case 'archived': return 'archived'
      case 'state': return `state:${sessionFilter.stateId}`
      case 'label': return `label:${sessionFilter.labelId}`
      case 'view': return `view:${sessionFilter.viewId}`
      default: return 'allSessions'
    }
  }, [sessionFilter])

  const [viewFiltersMap, setViewFiltersMap] = React.useState<ViewFiltersMap>(() => {
    const saved = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {})
    // Backward compat: migrate old format (arrays) into new format (Record<string, FilterMode>)
    if (saved.allSessions && Array.isArray((saved.allSessions as any).statuses)) {
      // Old format: { statuses: string[], labels: string[] } → new: { statuses: Record, labels: Record }
      for (const key of Object.keys(saved)) {
        const entry = saved[key] as any
        if (Array.isArray(entry.statuses)) {
          const newStatuses: FilterEntry = {}
          for (const id of entry.statuses) newStatuses[id] = 'include'
          const newLabels: FilterEntry = {}
          for (const id of entry.labels) newLabels[id] = 'include'
          saved[key] = { statuses: newStatuses, labels: newLabels }
        }
      }
    }
    // Also migrate legacy global filters if no allSessions entry exists
    if (!saved.allSessions) {
      const oldStatuses = storage.get<SessionStatusId[]>(storage.KEYS.listFilter, [])
      const oldLabels = storage.get<string[]>(storage.KEYS.labelFilter, [])
      if (oldStatuses.length > 0 || oldLabels.length > 0) {
        const statuses: FilterEntry = {}
        for (const id of oldStatuses) statuses[id] = 'include'
        const labels: FilterEntry = {}
        for (const id of oldLabels) labels[id] = 'include'
        saved.allSessions = { statuses, labels }
      }
    }
    return saved
  })

  // Derive current view's status filter as a Map<SessionStatusId, FilterMode>
  const listFilter = useMemo(() => {
    if (!sessionFilterKey) return new Map<SessionStatusId, FilterMode>()
    const entry = viewFiltersMap[sessionFilterKey]?.statuses ?? {}
    return new Map<SessionStatusId, FilterMode>(Object.entries(entry) as [SessionStatusId, FilterMode][])
  }, [viewFiltersMap, sessionFilterKey])

  // Derive current view's label filter as a Map<string, FilterMode>
  const labelFilter = useMemo(() => {
    if (!sessionFilterKey) return new Map<string, FilterMode>()
    const entry = viewFiltersMap[sessionFilterKey]?.labels ?? {}
    return new Map<string, FilterMode>(Object.entries(entry) as [string, FilterMode][])
  }, [viewFiltersMap, sessionFilterKey])

  // Setter for status filter — updates only the current view's entry in the map
  const setListFilter = useCallback((updater: Map<SessionStatusId, FilterMode> | ((prev: Map<SessionStatusId, FilterMode>) => Map<SessionStatusId, FilterMode>)) => {
    setViewFiltersMap(prev => {
      if (!sessionFilterKey) return prev
      const current = new Map<SessionStatusId, FilterMode>(Object.entries(prev[sessionFilterKey]?.statuses ?? {}) as [SessionStatusId, FilterMode][])
      const next = typeof updater === 'function' ? updater(current) : updater
      return {
        ...prev,
        [sessionFilterKey]: { statuses: Object.fromEntries(next), labels: prev[sessionFilterKey]?.labels ?? {} }
      }
    })
  }, [sessionFilterKey])

  // Setter for label filter — updates only the current view's entry in the map
  const setLabelFilter = useCallback((updater: Map<string, FilterMode> | ((prev: Map<string, FilterMode>) => Map<string, FilterMode>)) => {
    setViewFiltersMap(prev => {
      if (!sessionFilterKey) return prev
      const current = new Map<string, FilterMode>(Object.entries(prev[sessionFilterKey]?.labels ?? {}) as [string, FilterMode][])
      const next = typeof updater === 'function' ? updater(current) : updater
      return {
        ...prev,
        [sessionFilterKey]: { statuses: prev[sessionFilterKey]?.statuses ?? {}, labels: Object.fromEntries(next) }
      }
    })
  }, [sessionFilterKey])
  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = React.useState(false)

  // Grouping mode for chat list: per-view (stored in viewFiltersMap), forced to 'date' for state sub-views
  const isStateSubView = sessionFilter?.kind === 'state'

  const chatGroupingMode: ChatGroupingMode = isStateSubView
    ? 'date'
    : (viewFiltersMap[sessionFilterKey ?? '']?.groupingMode ?? 'date')

  const setChatGroupingMode = useCallback((mode: ChatGroupingMode) => {
    setViewFiltersMap(prev => {
      if (!sessionFilterKey) return prev
      const existing = prev[sessionFilterKey] ?? { statuses: {}, labels: {} }
      return {
        ...prev,
        [sessionFilterKey]: { ...existing, groupingMode: mode }
      }
    })
  }, [sessionFilterKey])

  // Ref for ChatDisplay navigation (exposed via forwardRef)
  const chatDisplayRef = React.useRef<ChatDisplayHandle>(null)
  // Track match count and index from ChatDisplay (for SessionList navigation UI)
  const [chatMatchInfo, setChatMatchInfo] = React.useState<{ sessionId: string | null; count: number; index: number; isHighlighting?: boolean }>({ sessionId: null, count: 0, index: 0 })

  // Callback for immediate match info updates from ChatDisplay
  // Memo guard prevents render feedback loops from identical updates
  const handleChatMatchInfoChange = React.useCallback((info: { sessionId: string | null; count: number; index: number; isHighlighting: boolean }) => {
    setChatMatchInfo(prev => {
      if (prev.sessionId === info.sessionId && prev.count === info.count && prev.index === info.index && prev.isHighlighting === info.isHighlighting) {
        return prev
      }
      return info
    })
  }, [])

  // Reset match info when search is deactivated
  React.useEffect(() => {
    if (!searchActive || !searchQuery) {
      setChatMatchInfo({ sessionId: null, count: 0, index: 0 })
    }
  }, [searchActive, searchQuery])

  // Filter dropdown: inline search query for filtering statuses/labels in a flat list.
  // When empty, the dropdown shows hierarchical submenus. When typing, shows a flat filtered list.
  const [filterDropdownQuery, setFilterDropdownQuery] = React.useState('')
  const [filterAltHeld, setFilterAltHeld] = React.useState(false)

  // Reset search only when navigator or filter changes (not when selecting sessions)
  const navFilterKey = React.useMemo(() => {
    if (isSessionsNavigation(navState)) {
      const filter = navState.filter
      return `chats:${filter.kind}:${filter.kind === 'state' ? filter.stateId : ''}`
    }
    return navState.navigator
  }, [navState])

  React.useEffect(() => {
    setSearchActive(false)
    setSearchQuery('')
  }, [navFilterKey])

  // Cmd+F opens the global search surface; the sidebar menu still owns local list search.
  useAction('app.search', () => setGlobalSearchOpen(true))

  // Unified sidebar keyboard navigation state
  // Load expanded folders from localStorage (default: all collapsed)
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[]>(storage.KEYS.expandedFolders, [])
    return new Set(saved)
  })
  const [focusedSidebarItemId, setFocusedSidebarItemId] = React.useState<string | null>(null)
  const sidebarItemRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  // Track which expandable directory items are collapsed.
  const [collapsedItems, setCollapsedItems] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null)
    return new Set(saved ?? [])
  })
  const isExpanded = React.useCallback((id: string) => !collapsedItems.has(id), [collapsedItems])
  const toggleExpanded = React.useCallback((id: string) => {
    setCollapsedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Sources state (workspace-scoped)
  const [sources, setSources] = React.useState<LoadedSource[]>([])
  // Sync sources to atom for NavigationContext auto-selection
  const setSourcesAtom = useSetAtom(sourcesAtom)
  React.useEffect(() => {
    setSourcesAtom(sources)
  }, [sources, setSourcesAtom])

  // Skills state (workspace-scoped)
  const [skills, setSkills] = React.useState<LoadedSkill[]>([])
  // Sync skills to atom for NavigationContext auto-selection
  const setSkillsAtom = useSetAtom(skillsAtom)
  React.useEffect(() => {
    setSkillsAtom(skills)
  }, [skills, setSkillsAtom])
  // Automations — state, handlers, loading, subscriptions
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  // Send to Workspace dialog state (driven by sendToWorkspaceAtom set from SessionMenu/BatchSessionMenu)
  const sendToWorkspaceIds = useAtomValue(sendToWorkspaceAtom)
  const setSendToWorkspaceIds = useSetAtom(sendToWorkspaceAtom)
  const handleTransferComplete = useCallback((targetWorkspaceId: string, _newSessionIds: string[]) => {
    onSelectWorkspace(targetWorkspaceId)
  }, [onSelectWorkspace])
  const {
    automations, automationTestResults,
    automationPendingDelete, pendingDeleteAutomation, setAutomationPendingDelete,
    handleTestAutomation, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, confirmDeleteAutomation,
    getAutomationHistory, handleReplayAutomation,
  } = useAutomations(activeWorkspaceId)

  // Whether local MCP servers are enabled (affects stdio source status)
  const [localMcpEnabled, setLocalMcpEnabled] = React.useState(true)

  // Enabled permission modes for Shift+Tab cycling (min 2 modes)
  const [enabledModes, setEnabledModes] = React.useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])

  // Load workspace settings (for localMcpEnabled and cyclablePermissionModes) on workspace change
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
        // Load cyclablePermissionModes from workspace settings
        if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
          setEnabledModes(settings.cyclablePermissionModes)
        }
      }
    }).catch((err) => {
      console.error('[Chat] Failed to load workspace settings:', err)
    })
  }, [activeWorkspaceId])

  // Reset UI state when workspace changes
  // This prevents stale search queries, focused items, and filter state from persisting
  const previousWorkspaceRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeWorkspaceId) return

    const previousWorkspaceId = previousWorkspaceRef.current

    // Clear transient UI state only on workspace SWITCH (not initial mount)
    if (previousWorkspaceId !== null && previousWorkspaceId !== activeWorkspaceId) {
      // Clear search state
      setSearchActive(false)
      setSearchQuery('')

      // Clear filter dropdown state
      setFilterDropdownQuery('')
      setFilterDropdownSelectedIdx(0)

      // Clear focused sidebar item
      setFocusedSidebarItemId(null)
    }

    // Load workspace-scoped state on BOTH initial mount AND workspace switch
    // This fixes CMD+R losing filters - previously only ran on workspace switch
    if (previousWorkspaceId !== activeWorkspaceId) {
      const newViewFilters = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {}, activeWorkspaceId)
      setViewFiltersMap(newViewFilters)

      const newExpandedFolders = storage.get<string[]>(storage.KEYS.expandedFolders, [], activeWorkspaceId)
      setExpandedFolders(new Set(newExpandedFolders))

      const newCollapsedItems = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null, activeWorkspaceId)
      setCollapsedItems(new Set(newCollapsedItems ?? []))
    }

    previousWorkspaceRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  // Load sources from backend on mount
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSources(activeWorkspaceId).then((loaded) => {
      setSources(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load sources:', err)
    })
  }, [activeWorkspaceId])

  // Subscribe to live source updates (when sources are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSourcesChanged((workspaceId, updatedSources) => {
      if (workspaceId !== activeWorkspaceId) return
      // Clear icon cache so updated source icons are re-fetched on render
      clearSourceIconCaches()
      setSources(updatedSources || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Subscribe to live skill updates (when skills are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSkillsChanged((workspaceId, updatedSkills) => {
      if (workspaceId !== activeWorkspaceId) return
      setSkills(updatedSkills || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Handle session source selection changes
  const handleSessionSourcesChange = React.useCallback(async (sessionId: string, sourceSlugs: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setSources', sourceSlugs })
      // Session will emit a 'sources_changed' event that updates the session state
    } catch (err) {
      console.error('[Chat] Failed to set session sources:', err)
    }
  }, [])

  // Handle session label changes (add/remove via # menu or badge X)
  const handleSessionLabelsChange = React.useCallback(async (sessionId: string, labels: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setLabels', labels })
      // Session will emit a 'labels_changed' event that updates the session state
    } catch (err) {
      console.error('[Chat] Failed to set session labels:', err)
    }
  }, [])


  // Load dynamic statuses from workspace config
  const { statuses: statusConfigs, isLoading: isLoadingStatuses } = useStatuses(activeWorkspace?.id || null)
  const [sessionStatuses, setSessionStatuses] = React.useState<SessionStatus[]>([])

  // Convert StatusConfig to SessionStatus with resolved icons
  React.useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setSessionStatuses([])
      return
    }

    setSessionStatuses(statusConfigsToSessionStatuses(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  // Optimistic status order: immediately reflects drag-drop order while IPC propagates.
  // Cleared when statusConfigs changes (config watcher is source of truth).
  const [optimisticStatusOrder, setOptimisticStatusOrder] = React.useState<string[] | null>(null)

  // Clear optimistic state when the config watcher fires (statusConfigs changes)
  React.useEffect(() => {
    setOptimisticStatusOrder(null)
  }, [statusConfigs])

  // Derive effective todo states: apply optimistic reorder if active, otherwise use canonical order
  const effectiveSessionStatuses = React.useMemo(() => {
    if (!optimisticStatusOrder) return sessionStatuses
    // Reorder sessionStatuses array to match optimistic order
    const stateMap = new Map(sessionStatuses.map(s => [s.id, s]))
    const reordered: SessionStatus[] = []
    for (const id of optimisticStatusOrder) {
      const state = stateMap.get(id)
      if (state) reordered.push(state)
    }
    // Append any states not in the optimistic order (shouldn't happen, but defensive)
    for (const state of sessionStatuses) {
      if (!optimisticStatusOrder.includes(state.id)) reordered.push(state)
    }
    return reordered
  }, [sessionStatuses, optimisticStatusOrder])

  // Load labels from workspace config
  const { labels: labelConfigs } = useLabels(activeWorkspace?.id || null)
  const displayLabelConfigs = useMemo(() => sortLabelsForDisplay(labelConfigs), [labelConfigs])

  // Views: compiled once on config load, evaluated per session in list/chat
  const { evaluateSession: evaluateViews, viewConfigs } = useViews(activeWorkspace?.id || null)

  // Build flat LabelMenuItem[] from hierarchical labels for the filter dropdown's search mode.
  // Uses the same structure as the # inline menu so the two search surfaces stay aligned.
  const flatLabelMenuItems = useMemo(
    (): LabelMenuItem[] => createLabelMenuItems(displayLabelConfigs),
    [displayLabelConfigs],
  )

  // Filter dropdown keyboard navigation: tracks highlighted item index in flat search mode.
  // Unified index: [0..matchedStates-1] = statuses, [matchedStates..total-1] = labels.
  const [filterDropdownSelectedIdx, setFilterDropdownSelectedIdx] = React.useState(0)
  const filterDropdownListRef = React.useRef<HTMLDivElement>(null)
  const filterDropdownInputRef = React.useRef<HTMLInputElement>(null)

  // Compute filtered results for the dropdown's search mode (memoized for use in both
  // the keyboard handler and the JSX render).
  const filterDropdownResults = useMemo(() => {
    if (!filterDropdownQuery.trim()) return { states: [] as SessionStatus[], labels: [] as LabelMenuItem[] }
    return {
      states: filterLabelMenuStates(effectiveSessionStatuses, filterDropdownQuery),
      labels: filterLabelMenuItems(flatLabelMenuItems, filterDropdownQuery),
    }
  }, [filterDropdownQuery, effectiveSessionStatuses, flatLabelMenuItems])

  // Reset selected index when query changes
  React.useEffect(() => {
    setFilterDropdownSelectedIdx(0)
  }, [filterDropdownQuery])

  // Scroll keyboard-highlighted item into view
  React.useEffect(() => {
    if (!filterDropdownListRef.current) return
    const el = filterDropdownListRef.current.querySelector('[data-filter-selected="true"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [filterDropdownSelectedIdx])

  // Ensure session messages are loaded when selected
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)

  // Handle selecting a source from the list (preserves current filter type)
  const handleSourceSelect = React.useCallback((source: LoadedSource) => {
    if (!activeWorkspaceId) return
    navigateToSource(source.config.slug)
  }, [activeWorkspaceId, navigateToSource])

  // Handle selecting a skill from the list
  const handleSkillSelect = React.useCallback((skill: LoadedSkill) => {
    if (!activeWorkspaceId) return
    navigate(routes.view.skills(skill.slug))
  }, [activeWorkspaceId, navigate])

  // Handle selecting an automation from the list
  const handleAutomationSelect = React.useCallback((automationId: string) => {
    // Preserve current automation filter when selecting an automation
    const type = isAutomationsNavigation(navState) ? navState.filter?.automationType : undefined
    navigate(routes.view.automations({ automationId, type }))
  }, [navState, navigate])

  // Focus zone management
  const { focusZone, focusNextZone, focusPreviousZone } = useFocusContext()

  // Register focus zones
  const { zoneRef: sidebarRef, isFocused: sidebarFocused } = useFocusZone({ zoneId: 'sidebar' })

  // Global keyboard shortcuts using centralized action registry
  // Actions are defined in @/actions/definitions.ts

  // Zone navigation - explicit keyboard intent, always move DOM focus
  useAction('nav.focusSidebar', () => focusZone('sidebar', { intent: 'keyboard' }))
  useAction('nav.focusNavigator', () => focusZone('navigator', { intent: 'keyboard' }))
  useAction('nav.focusChat', () => focusZone('chat', { intent: 'keyboard' }))

  // Tab navigation between zones
  useAction('nav.nextZone', () => {
    focusNextZone()
  }, { enabled: () => !document.querySelector('[role="dialog"]') })

  // Shift+Tab cycles permission mode through enabled modes (textarea handles its own, this handles when focus is elsewhere)
  // In multi-panel, targets the focused panel's session
  const rawEffectiveSessionId = focusedSessionId ?? session.selected
  const rawEffectiveSessionMeta = rawEffectiveSessionId ? sessionMetaMap.get(rawEffectiveSessionId) : undefined
  const rawEffectiveSessionBelongsToWorkspace = !!rawEffectiveSessionMeta && (
    rawEffectiveSessionMeta?.workspaceId === activeWorkspaceId
    || (!!remoteWorkspaceId && rawEffectiveSessionMeta?.workspaceId === remoteWorkspaceId)
  )
  const effectiveSessionId = rawEffectiveSessionBelongsToWorkspace ? rawEffectiveSessionId : null

  // Focus chat input for the target session only (multi-panel safe).
  const focusChatInputForSession = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) return
    dispatchFocusInputEvent({ sessionId: targetSessionId })
  }, [])

  useAction('chat.cyclePermissionMode', () => {
    if (effectiveSessionId) {
      const currentOptions = contextValue.sessionOptions.get(effectiveSessionId)
      const currentMode = currentOptions?.permissionMode ?? 'ask'
      // Cycle through enabled permission modes
      const modes = enabledModes.length >= 2 ? enabledModes : ['safe', 'ask', 'allow-all'] as PermissionMode[]
      const currentIndex = modes.indexOf(currentMode)
      // If current mode not in enabled list, jump to first enabled mode
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
      const nextMode = modes[nextIndex]
      contextValue.onSessionOptionsChange(effectiveSessionId, { permissionMode: nextMode })
    }
  })

  const handleToggleSidebar = useCallback(() => {
    if (isSidebarAndNavigatorHidden) {
      setIsSidebarAndNavigatorHidden(false)
      return
    }
    setIsSidebarVisible(v => !v)
  }, [isSidebarAndNavigatorHidden])

  // Sidebar toggle (CMD+B)
  useAction('view.toggleSidebar', handleToggleSidebar)

  // Focus mode toggle (CMD+.) - hides both sidebars
  useAction('view.toggleFocusMode', () => setIsSidebarAndNavigatorHidden(v => !v))

  // Panel focus navigation (CMD+SHIFT+[ / ])
  const focusNextPanel = useSetAtom(focusNextPanelAtom)
  const focusPrevPanel = useSetAtom(focusPrevPanelAtom)
  useAction('panel.focusNext', focusNextPanel, { enabled: () => panelCount > 1 })
  useAction('panel.focusPrev', focusPrevPanel, { enabled: () => panelCount > 1 })

  // New chat
  useAction('app.newChat', () => handleNewChat())
  useAction('app.newChatInPanel', () => handleNewChat(true))

  // Settings
  useAction('app.settings', onOpenSettings)

  // Keyboard shortcuts
  useAction('app.keyboardShortcuts', onOpenKeyboardShortcuts)

  // New window
  useAction('app.newWindow', () => window.electronAPI.menuNewWindow())

  // Quit (note: also handled by native menu on macOS)
  useAction('app.quit', () => window.electronAPI.menuQuit())

  // History navigation
  useAction('nav.goBack', goBack)
  useAction('nav.goForward', goForward)

  // History navigation (arrow key alternatives)
  useAction('nav.goBackAlt', goBack)
  useAction('nav.goForwardAlt', goForward)

  // Search match navigation (CMD+G next, CMD+SHIFT+G prev)
  useAction('chat.nextSearchMatch', () => chatDisplayRef.current?.goToNextMatch(), {
    enabled: () => searchActive && (chatMatchInfo.count ?? 0) > 0
  })
  useAction('chat.prevSearchMatch', () => chatDisplayRef.current?.goToPrevMatch(), {
    enabled: () => searchActive && (chatMatchInfo.count ?? 0) > 0
  })

  // ESC to stop processing - requires double-press within 1 second
  // First press shows warning overlay, second press interrupts
  // In multi-panel, targets the focused panel's session
  useAction('chat.stopProcessing', () => {
    if (effectiveSessionId) {
      const meta = sessionMetaMap.get(effectiveSessionId)
      if (meta?.isProcessing) {
        // handleEscapePress returns true on second press (within timeout)
        const shouldInterrupt = handleEscapePress()
        if (shouldInterrupt) {
          window.electronAPI.cancelProcessing(effectiveSessionId, false).catch(err => {
            console.error('[AppShell] Failed to cancel processing:', err)
          })
        }
      }
    }
  }, {
    // Only active when no overlay is open and session is processing
    // Overlays (dialogs, menus, popovers, etc.) should handle their own Escape
    enabled: () => {
      if (hasOpenOverlay()) return false
      if (!effectiveSessionId) return false
      const meta = sessionMetaMap.get(effectiveSessionId)
      return meta?.isProcessing ?? false
    }
  }, [effectiveSessionId, handleEscapePress])

  // Theme toggle (CMD+SHIFT+A)
  useAction('app.toggleTheme', () => setMode(resolvedMode === 'dark' ? 'light' : 'dark'))

  // Global paste listener for file attachments
  // Fires when Cmd+V is pressed anywhere in the app (not just textarea)
  React.useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Skip if a dialog or menu is open
      if (document.querySelector('[role="dialog"], [role="menu"]')) {
        return
      }

      // Skip if there are no files in the clipboard
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return

      // Skip if the active element is an input/textarea/contenteditable (let it handle paste directly)
      const activeElement = document.activeElement as HTMLElement | null
      if (
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'INPUT' ||
        activeElement?.isContentEditable
      ) {
        return
      }

      // Prevent default paste behavior
      e.preventDefault()

      // Dispatch custom event for FreeFormInput to handle (target focused session only)
      const filesArray = Array.from(files)
      const targetSessionId = focusedSessionId ?? session.selected
      if (!targetSessionId) return
      window.dispatchEvent(new CustomEvent('craft:paste-files', {
        detail: { files: filesArray, sessionId: targetSessionId }
      }))
    }

    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [focusedSessionId, session.selected])

  React.useEffect(() => {
    latestSidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  React.useEffect(() => {
    latestSessionListWidthRef.current = sessionListWidth
  }, [sessionListWidth])

  React.useEffect(() => {
    latestNovelWorkspaceNavigatorWidthRef.current = novelWorkspaceNavigatorWidth
  }, [novelWorkspaceNavigatorWidth])

  React.useEffect(() => {
    if (
      initialShellLayoutResolvedRef.current
      || !shouldResolveInitialShellLayoutWidths(shellWidth, MOBILE_THRESHOLD)
    ) return
    initialShellLayoutResolvedRef.current = true

    const sidebarPersisted = isUserConfiguredShellLayoutWidth(
      'sidebar',
      latestSidebarWidthRef.current,
      storage.getRaw(storage.KEYS.sidebarWidth) !== null
    )
    const workspacePersisted = isUserConfiguredShellLayoutWidth(
      'workspace',
      latestNovelWorkspaceNavigatorWidthRef.current,
      storage.getRaw(storage.KEYS.novelWorkspaceNavigatorWidth) !== null
    )
    if (sidebarPersisted && workspacePersisted) return

    const widths = resolveInitialShellLayoutWidths({
      totalWidth: shellWidth,
      edgeInset: PANEL_EDGE_INSET,
      panelGap: PANEL_GAP,
      assistantMinWidth: PANEL_MIN_WIDTH,
      sidebarPersisted,
      workspacePersisted,
      currentSidebarWidth: latestSidebarWidthRef.current,
      currentWorkspaceWidth: latestNovelWorkspaceNavigatorWidthRef.current,
    })

    if (!sidebarPersisted) {
      latestSidebarWidthRef.current = widths.sidebar
      setSidebarWidth(widths.sidebar)
    }
    if (!workspacePersisted) {
      latestNovelWorkspaceNavigatorWidthRef.current = widths.workspace
      setNovelWorkspaceNavigatorWidth(widths.workspace)
    }
  }, [shellWidth])

  const beginResize = React.useCallback((
    mode: 'sidebar' | 'session-list' | 'novel-workspace-navigator',
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(mode)

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const updateHandleY = (clientY: number) => {
      const handle = mode === 'sidebar' ? resizeHandleRef.current : sessionListHandleRef.current
      if (!handle) return
      const rect = handle.getBoundingClientRect()
      if (mode === 'sidebar') {
        setSidebarHandleY(clientY - rect.top)
      } else {
        setSessionListHandleY(clientY - rect.top)
      }
    }

    const updateWidth = (clientX: number) => {
      if (mode === 'sidebar') {
        const newWidth = Math.min(Math.max(clientX - (PANEL_GAP / 2), 180), 320)
        latestSidebarWidthRef.current = newWidth
        setSidebarWidth(newWidth)
        return
      }

      const minWidth = mode === 'novel-workspace-navigator'
        ? NOVEL_WORKSPACE_NAVIGATOR_MIN_WIDTH
        : SESSION_LIST_MIN_WIDTH
      const maxWidth = mode === 'novel-workspace-navigator'
        ? Number.POSITIVE_INFINITY
        : SESSION_LIST_MAX_WIDTH
      const fallbackNavigatorStartX = isSidebarVisible
        ? latestSidebarWidthRef.current + PANEL_GAP
        : PANEL_EDGE_INSET
      const navigatorStartX = navigatorPanelRef.current?.getBoundingClientRect().left ?? fallbackNavigatorStartX
      const effectiveMaxWidth = mode === 'novel-workspace-navigator'
        ? Math.max(
          minWidth,
          getNavigatorResizeMaxWidth({
            shellWidth,
            navigatorStartX,
            edgeInset: PANEL_EDGE_INSET,
            panelGap: PANEL_GAP,
            assistantMinWidth: PANEL_MIN_WIDTH,
          })
        )
        : maxWidth
      const newWidth = Math.min(
        Math.max(clientX - navigatorStartX - (PANEL_GAP / 2), minWidth),
        effectiveMaxWidth
      )
      if (mode === 'novel-workspace-navigator') {
        latestNovelWorkspaceNavigatorWidthRef.current = newWidth
        setNovelWorkspaceNavigatorWidth(newWidth)
        return
      }

      latestSessionListWidthRef.current = newWidth
      setSessionListWidth(newWidth)
    }

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault()
      updateWidth(event.clientX)
      updateHandleY(event.clientY)
    }

    const handleMouseUp = () => {
      if (mode === 'sidebar') {
        storage.set(storage.KEYS.sidebarWidth, latestSidebarWidthRef.current)
        setSidebarHandleY(null)
      } else if (mode === 'novel-workspace-navigator') {
        storage.set(storage.KEYS.novelWorkspaceNavigatorWidth, latestNovelWorkspaceNavigatorWidthRef.current)
        setSessionListHandleY(null)
      } else {
        storage.set(storage.KEYS.sessionListWidth, latestSessionListWidthRef.current)
        setSessionListHandleY(null)
      }

      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setIsResizing(null)
      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
    }

    updateHandleY(e.clientY)
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('mouseup', handleMouseUp, true)
  }, [isSidebarVisible, shellWidth])

  // Spring transition config - shared between sidebar and header
  // Critical damping (no bounce): damping = 2 * sqrt(stiffness * mass)
  const springTransition = {
    type: "spring" as const,
    stiffness: 600,
    damping: 49,
  }

  const effectiveSession = useAtomValue(sessionAtomFamily(effectiveSessionId ?? '__missing__'))

  const hasPendingPrompt = React.useCallback((sessionId: string) => {
    return (pendingPermissions.get(sessionId)?.length ?? 0) > 0
  }, [pendingPermissions])

  // Workspace-level unread indicators (needed for workspace selectors across all workspaces)
  const [workspaceUnreadMap, setWorkspaceUnreadMap] = useState<Record<string, boolean>>({})

  // Reload skills when active session's workingDirectory changes (for project-level skills)
  // Skills are loaded from: global (~/.agents/skills/), workspace, and project ({workingDirectory}/.agents/skills/)
  const activeSessionMeta = effectiveSessionId ? sessionMetaMap.get(effectiveSessionId) : undefined
  const activeSessionBelongsToWorkspace = !!activeSessionMeta && (
    activeSessionMeta?.workspaceId === activeWorkspaceId
    || (!!remoteWorkspaceId && activeSessionMeta?.workspaceId === remoteWorkspaceId)
  )
  const activeSessionWorkingDirectory = activeSessionBelongsToWorkspace
    ? activeSessionMeta?.workingDirectory
    : undefined

  const latestNovelFileChanges = React.useMemo<FileChange[]>(() => {
    if (!effectiveSession?.messages?.length) return []

    const turns = groupMessagesByTurn(effectiveSession.messages)
    for (const turn of [...turns].reverse()) {
      if (turn.type !== 'assistant') continue
      const changes = collectFileChangesFromActivities(turn.activities, {
        basePath: activeSessionWorkingDirectory || effectiveSession.sessionFolderPath,
      })
      if (changes.length > 0) return changes
    }
    return []
  }, [activeSessionWorkingDirectory, effectiveSession?.messages, effectiveSession?.sessionFolderPath])

  const novelWorkspaceCandidateRoots = React.useMemo(
    () => getNovelWorkspaceCandidateRoots({
      activeWorkspaceRootPath: activeWorkspace?.rootPath,
      sessionWorkingDirectory: activeSessionWorkingDirectory,
    }),
    [activeWorkspace?.rootPath, activeSessionWorkingDirectory]
  )
  const novelWorkspaceCandidateKey = React.useMemo(
    () => novelWorkspaceCandidateRoots.join('\0'),
    [novelWorkspaceCandidateRoots]
  )
  const [novelWorkspaceRoot, setNovelWorkspaceRoot] = React.useState<string | null>(null)
  const [novelWorkspaceFiles, setNovelWorkspaceFiles] = React.useState<NovelWorkspaceFile[]>([])
  const [novelWorkspaceDetecting, setNovelWorkspaceDetecting] = React.useState(false)
  const [novelWorkspaceDetectionSettledKey, setNovelWorkspaceDetectionSettledKey] = React.useState<string | null>(null)
  const novelWorkspaceRootRef = React.useRef<string | null>(null)
  const novelWorkspaceFilesCacheRef = React.useRef<Map<string, NovelWorkspaceFile[]>>(new Map())
  const [novelCreateFileTarget, setNovelCreateFileTarget] = React.useState<NovelCreateFileTarget | null>(null)
  const [novelCreateFileValue, setNovelCreateFileValue] = React.useState('')
  const [novelCreatingFile, setNovelCreatingFile] = React.useState(false)

  React.useEffect(() => {
    novelWorkspaceRootRef.current = novelWorkspaceRoot
  }, [novelWorkspaceRoot])

  const loadNovelWorkspaceFiles = React.useCallback(async (
    rootPath: string,
    onDetected?: (files: NovelWorkspaceFile[]) => void
  ): Promise<NovelWorkspaceFile[] | null> => {
    const probeResultSets = await searchNovelWorkspaceFiles(rootPath,
      NOVEL_WORKSPACE_DETECTION_QUERIES.map((query) => ({
        query,
        options: { mode: 'path' as const, includeDescendants: false },
      }))
    )
    const probeResults = probeResultSets.flatMap(resultSet => resultSet.results)
    if (!detectNovelProjectFromSearchResults(probeResults)) return null
    const probeFiles = mapSearchResultsToNovelWorkspaceFiles(probeResults)
    onDetected?.(probeFiles)

    const catalogResultSets = await searchNovelWorkspaceFiles(rootPath,
      NOVEL_WORKSPACE_CATALOG_DIRECTORY_QUERIES.map((query) => ({
        query,
        options: { mode: 'path' as const },
      }))
    )
    const catalogResults = catalogResultSets.flatMap(resultSet => resultSet.results)
    const results = [...probeResults, ...catalogResults]

    const files = mapSearchResultsToNovelWorkspaceFiles(results)
    novelWorkspaceFilesCacheRef.current.set(rootPath, files)
    return files
  }, [])

  const refreshNovelWorkspaceFiles = React.useCallback(async (rootPath: string): Promise<boolean> => {
    const files = await loadNovelWorkspaceFiles(rootPath)
    if (!files) return false

    setNovelWorkspaceRoot(rootPath)
    setNovelWorkspaceFiles(files)
    return true
  }, [loadNovelWorkspaceFiles])

  const openNovelCreateFileDialog = React.useCallback((target: NovelCreateFileTarget) => {
    setNovelCreateFileTarget(target)
    setNovelCreateFileValue(target.initialValue)
  }, [])

  const handleSubmitNovelCreateFile = React.useCallback(async () => {
    if (!novelWorkspaceRoot || !novelCreateFileTarget) return

    const relativePath = normalizeNovelCreateFilePath(novelCreateFileValue, novelCreateFileTarget.basePath)
    if (!relativePath) {
      toast.error(t('writing.createFile.invalidName', '请输入有效文件名'))
      return
    }
    if (novelWorkspaceFiles.some(file => file.relativePath === relativePath)) {
      toast.error(t('writing.createFile.exists', '文件已存在'))
      return
    }

    const targetPath = joinWorkspacePath(novelWorkspaceRoot, relativePath)
    const parentRelativePath = getParentRelativePath(relativePath)
    const parentPath = joinWorkspacePath(novelWorkspaceRoot, parentRelativePath)
    const title = getMarkdownTitleFromRelativePath(relativePath)
    const initialContent = shouldCreateMarkdownStarter(relativePath) && title ? `# ${title}\n\n` : ''

    setNovelCreatingFile(true)
    try {
      await window.electronAPI.createDirectory(parentPath)
      await window.electronAPI.writeFile(targetPath, initialContent)
      await refreshNovelWorkspaceFiles(novelWorkspaceRoot)
      setSelectedNovelFilePath(targetPath)
      navigate(routes.view.allSessions())
      setNovelCreateFileTarget(null)
      setNovelCreateFileValue('')
    } catch (error) {
      console.error('[AppShell] Failed to create writing file:', error)
      toast.error(t('writing.createFile.failed', '创建文件失败'))
    } finally {
      setNovelCreatingFile(false)
    }
  }, [novelCreateFileTarget, novelCreateFileValue, novelWorkspaceFiles, novelWorkspaceRoot, refreshNovelWorkspaceFiles, t])

  const handleImportNovelFiles = React.useCallback(async (basePath: NovelCreateFileBasePath) => {
    if (!novelWorkspaceRoot) return

    const sourcePaths = await window.electronAPI.openFileDialog()
    if (sourcePaths.length === 0) return

    let importedCount = 0
    let skippedCount = 0
    let lastImportedPath: string | null = null
    const reservedRelativePaths = new Set(novelWorkspaceFiles.map(file => file.relativePath))

    for (const sourcePath of sourcePaths) {
      const relativePath = getNovelImportTargetRelativePath(sourcePath, basePath)
      if (!relativePath || reservedRelativePaths.has(relativePath)) {
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
        reservedRelativePaths.add(relativePath)
        lastImportedPath = targetPath
      } catch (error) {
        console.error('[AppShell] Failed to import writing file:', error)
        skippedCount += 1
      }
    }

    if (importedCount > 0) {
      await refreshNovelWorkspaceFiles(novelWorkspaceRoot)
      if (lastImportedPath) {
        setSelectedNovelFilePath(lastImportedPath)
        navigate(routes.view.allSessions())
      }
      toast.success(t('writing.importFile.success', '已导入文件'))
    }
    if (skippedCount > 0) {
      toast.error(t('writing.importFile.skipped', '部分文件未导入，仅支持不重名的 md/txt 文件'))
    }
  }, [novelWorkspaceFiles, novelWorkspaceRoot, refreshNovelWorkspaceFiles, t])

  React.useEffect(() => {
    if (novelWorkspaceCandidateRoots.length === 0) {
      setNovelWorkspaceDetecting(false)
      setNovelWorkspaceDetectionSettledKey(null)
      setNovelWorkspaceRoot(null)
      setNovelWorkspaceFiles([])
      return
    }

    const nextCandidateRoots = new Set(novelWorkspaceCandidateRoots)
    const currentNovelWorkspaceRoot = novelWorkspaceRootRef.current
    const shouldKeepWorkspaceChromeWhileDetecting = !currentNovelWorkspaceRoot || !nextCandidateRoots.has(currentNovelWorkspaceRoot)
    setNovelWorkspaceDetecting(shouldKeepWorkspaceChromeWhileDetecting)

    if (currentNovelWorkspaceRoot && !nextCandidateRoots.has(currentNovelWorkspaceRoot)) {
      setNovelWorkspaceRoot(null)
      setNovelWorkspaceFiles([])
    }

    let cancelled = false

    async function detectNovelWorkspace(): Promise<void> {
      for (const rootPath of novelWorkspaceCandidateRoots) {
        const cachedNovelWorkspaceFiles = novelWorkspaceFilesCacheRef.current.get(rootPath)
        if (cachedNovelWorkspaceFiles) {
          setNovelWorkspaceRoot(rootPath)
          setNovelWorkspaceFiles(cachedNovelWorkspaceFiles)
          setNovelWorkspaceDetectionSettledKey(novelWorkspaceCandidateKey)
          setNovelWorkspaceDetecting(false)
        }

        try {
          const files = await loadNovelWorkspaceFiles(rootPath, (probeFiles) => {
            if (cancelled) return
            setNovelWorkspaceRoot(rootPath)
            setNovelWorkspaceFiles(probeFiles)
            setNovelWorkspaceDetectionSettledKey(novelWorkspaceCandidateKey)
            setNovelWorkspaceDetecting(false)
          })
          if (cancelled) return

          if (files) {
            setNovelWorkspaceRoot(rootPath)
            setNovelWorkspaceFiles(files)
            setNovelWorkspaceDetectionSettledKey(novelWorkspaceCandidateKey)
            setNovelWorkspaceDetecting(false)
            return
          }
        } catch {
          if (cancelled) return
        }
      }

      setNovelWorkspaceRoot(null)
      setNovelWorkspaceFiles([])
      setNovelWorkspaceDetectionSettledKey(novelWorkspaceCandidateKey)
      setNovelWorkspaceDetecting(false)
    }

    void detectNovelWorkspace()

    return () => {
      cancelled = true
    }
  }, [loadNovelWorkspaceFiles, novelWorkspaceCandidateKey, novelWorkspaceCandidateRoots])

  React.useEffect(() => {
    if (!novelWorkspaceRoot || latestNovelFileChanges.length === 0) return

    const timeoutId = window.setTimeout(() => {
      void refreshNovelWorkspaceFiles(novelWorkspaceRoot)
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [latestNovelFileChanges, novelWorkspaceRoot, refreshNovelWorkspaceFiles])

  const novelWorkspaceCandidateRootSet = React.useMemo(
    () => new Set(novelWorkspaceCandidateRoots),
    [novelWorkspaceCandidateRoots]
  )
  const novelWorkspaceRootMatchesCandidates = !!novelWorkspaceRoot && novelWorkspaceCandidateRootSet.has(novelWorkspaceRoot)
  const hasStaleNovelWorkspaceRoot = !!novelWorkspaceRoot && novelWorkspaceCandidateRoots.length > 0 && !novelWorkspaceRootMatchesCandidates
  const hasUnsettledNovelWorkspaceCandidates = novelWorkspaceCandidateRoots.length > 0 && novelWorkspaceDetectionSettledKey !== novelWorkspaceCandidateKey
  const showNovelWorkspaceSidebar = novelWorkspaceRootMatchesCandidates
  const showNovelDocumentNavigator = isSessionsNavigation(navState) && showNovelWorkspaceSidebar
  const showNovelWorkspacePending = isSessionsNavigation(navState) && (
    novelWorkspaceDetecting
    || hasStaleNovelWorkspaceRoot
    || (!showNovelWorkspaceSidebar && hasUnsettledNovelWorkspaceCandidates)
  )
  const showNovelWorkspaceUnavailable = isSessionsNavigation(navState)
    && novelWorkspaceCandidateRoots.length > 0
    && !showNovelWorkspaceSidebar
    && !showNovelWorkspacePending
  const reviewableNovelFileChanges = React.useMemo(
    () => normalizeNovelFileChangePaths(latestNovelFileChanges, novelWorkspaceRoot, novelWorkspaceFiles),
    [latestNovelFileChanges, novelWorkspaceFiles, novelWorkspaceRoot]
  )
  const novelWorkspaceTree = React.useMemo(
    () => buildNovelWorkspaceTree(novelWorkspaceFiles),
    [novelWorkspaceFiles]
  )
  const isShortFormNovelWorkspace = React.useMemo(
    () => isShortFormNovelWorkspaceFiles(novelWorkspaceFiles),
    [novelWorkspaceFiles]
  )
  const defaultNovelFile = React.useMemo(
    () => selectDefaultNovelFile(novelWorkspaceFiles),
    [novelWorkspaceFiles]
  )
  const [selectedNovelFilePath, setSelectedNovelFilePath] = React.useState<string | null>(null)
  const selectedNovelFile = React.useMemo(() => {
    if (!showNovelWorkspaceSidebar) return undefined
    return novelWorkspaceFiles.find(file => file.path === selectedNovelFilePath) ?? defaultNovelFile
  }, [defaultNovelFile, novelWorkspaceFiles, selectedNovelFilePath, showNovelWorkspaceSidebar])

  React.useEffect(() => {
    if (!showNovelWorkspaceSidebar) {
      setSelectedNovelFilePath(null)
      return
    }

    if (selectedNovelFilePath && novelWorkspaceFiles.some(file => file.path === selectedNovelFilePath)) {
      return
    }

    setSelectedNovelFilePath(defaultNovelFile?.path ?? null)
  }, [defaultNovelFile?.path, novelWorkspaceFiles, selectedNovelFilePath, showNovelWorkspaceSidebar])

  const [novelDocumentContent, setNovelDocumentContent] = React.useState('')
  const [savedNovelDocumentContent, setSavedNovelDocumentContent] = React.useState('')
  const [novelDocumentLoading, setNovelDocumentLoading] = React.useState(false)
  const [novelDocumentSaving, setNovelDocumentSaving] = React.useState(false)
  const [novelDocumentError, setNovelDocumentError] = React.useState<string | null>(null)
  const [novelExportDialogOpen, setNovelExportDialogOpen] = React.useState(false)
  const [novelExporting, setNovelExporting] = React.useState(false)
  const [novelVersionDialogOpen, setNovelVersionDialogOpen] = React.useState(false)
  const [novelVersions, setNovelVersions] = React.useState<WorkspaceVersionEntry[]>([])
  const [novelVersionsLoading, setNovelVersionsLoading] = React.useState(false)
  const [novelVersionSaving, setNovelVersionSaving] = React.useState(false)
  const [novelVersionRestoringHash, setNovelVersionRestoringHash] = React.useState<string | null>(null)
  const selectedNovelDocumentPath = selectedNovelFile?.path ?? null
  const latestNovelDocumentPathRef = React.useRef<string | null>(null)
  const novelDocumentSaveSeqRef = React.useRef(0)
  const novelVersionBaselinesRef = React.useRef<Record<string, { content: string; timestamp: number }>>({})
  const novelAutoVersionInFlightRef = React.useRef(false)
  const novelAutoVersionTimerRef = React.useRef<number | null>(null)
  const novelAgentTurnCheckpointInFlightRef = React.useRef(false)
  const novelSessionProcessingRef = React.useRef<Record<string, boolean>>({})
  const novelAgentTouchedPathsRef = React.useRef<Record<string, string[]>>({})

  React.useEffect(() => {
    latestNovelDocumentPathRef.current = selectedNovelDocumentPath
  }, [selectedNovelDocumentPath])

  React.useEffect(() => {
    novelVersionBaselinesRef.current = {}
    setNovelVersions([])
    if (novelAutoVersionTimerRef.current != null) {
      window.clearTimeout(novelAutoVersionTimerRef.current)
      novelAutoVersionTimerRef.current = null
    }
  }, [novelWorkspaceRoot])

  React.useEffect(() => {
    if (!selectedNovelDocumentPath) {
      setNovelDocumentContent('')
      setSavedNovelDocumentContent('')
      setNovelDocumentLoading(false)
      setNovelDocumentError(null)
      return
    }

    let cancelled = false
    setNovelDocumentLoading(true)
    setNovelDocumentError(null)

    window.electronAPI.readFile(selectedNovelDocumentPath)
      .then((content) => {
        if (cancelled) return
        setNovelDocumentContent(content)
        setSavedNovelDocumentContent(content)
        novelVersionBaselinesRef.current[selectedNovelDocumentPath] ??= {
          content,
          timestamp: Date.now(),
        }
      })
      .catch((error) => {
        if (cancelled) return
        setNovelDocumentContent('')
        setSavedNovelDocumentContent('')
        setNovelDocumentError(error instanceof Error ? error.message : 'Failed to load document')
      })
      .finally(() => {
        if (!cancelled) setNovelDocumentLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedNovelDocumentPath])

  const novelDocumentDirty = !!selectedNovelFile && novelDocumentContent !== savedNovelDocumentContent

  const refreshNovelVersions = React.useCallback(async () => {
    if (!novelWorkspaceRoot) {
      setNovelVersions([])
      return
    }
    setNovelVersionsLoading(true)
    try {
      setNovelVersions(await window.electronAPI.listWorkspaceVersions(novelWorkspaceRoot, 30))
    } catch (error) {
      toast.error(t('writing.version.loadFailed', '加载版本历史失败'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setNovelVersionsLoading(false)
    }
  }, [novelWorkspaceRoot, t])

  const maybeCreateNovelAutoVersion = React.useCallback(async (filePath: string, content: string) => {
    if (!novelWorkspaceRoot || novelAutoVersionInFlightRef.current) return

    const now = Date.now()
    const baseline = novelVersionBaselinesRef.current[filePath] ?? { content, timestamp: now }
    if (content === baseline.content) return

    const charDelta = getContentChangeSize(baseline.content, content)
    const elapsed = now - baseline.timestamp
    if (charDelta < NOVEL_AUTO_VERSION_CHAR_THRESHOLD && elapsed < NOVEL_AUTO_VERSION_INTERVAL_MS) {
      if (novelAutoVersionTimerRef.current == null) {
        novelAutoVersionTimerRef.current = window.setTimeout(async () => {
          novelAutoVersionTimerRef.current = null
          try {
            const latestContent = await window.electronAPI.readFile(filePath)
            await maybeCreateNovelAutoVersion(filePath, latestContent)
          } catch (error) {
            console.warn('[writing] Failed to create scheduled auto version:', error)
          }
        }, NOVEL_AUTO_VERSION_INTERVAL_MS - elapsed)
      }
      return
    }

    if (novelAutoVersionTimerRef.current != null) {
      window.clearTimeout(novelAutoVersionTimerRef.current)
      novelAutoVersionTimerRef.current = null
    }

    novelAutoVersionInFlightRef.current = true
    try {
      await window.electronAPI.createWorkspaceVersion(novelWorkspaceRoot, { reason: 'auto' })
      novelVersionBaselinesRef.current[filePath] = { content, timestamp: Date.now() }
      if (novelVersionDialogOpen) {
        await refreshNovelVersions()
      }
    } catch (error) {
      console.warn('[writing] Failed to create auto version:', error)
    } finally {
      novelAutoVersionInFlightRef.current = false
    }
  }, [novelVersionDialogOpen, novelWorkspaceRoot, refreshNovelVersions])

  React.useEffect(() => {
    if (!selectedNovelDocumentPath || !novelDocumentDirty || novelDocumentLoading) return

    const pathToSave = selectedNovelDocumentPath
    const contentToSave = novelDocumentContent
    const timeoutId = window.setTimeout(() => {
      const saveSeq = ++novelDocumentSaveSeqRef.current
      setNovelDocumentSaving(true)
      setNovelDocumentError(null)

      window.electronAPI.writeFile(pathToSave, contentToSave)
        .then(() => {
          if (novelDocumentSaveSeqRef.current === saveSeq && latestNovelDocumentPathRef.current === pathToSave) {
            setSavedNovelDocumentContent(contentToSave)
          }
          void maybeCreateNovelAutoVersion(pathToSave, contentToSave)
        })
        .catch((error) => {
          if (novelDocumentSaveSeqRef.current !== saveSeq || latestNovelDocumentPathRef.current !== pathToSave) return
          setNovelDocumentError(error instanceof Error ? error.message : 'Failed to save document')
        })
        .finally(() => {
          if (novelDocumentSaveSeqRef.current === saveSeq) {
            setNovelDocumentSaving(false)
          }
        })
    }, 800)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [maybeCreateNovelAutoVersion, novelDocumentContent, novelDocumentDirty, novelDocumentLoading, selectedNovelDocumentPath])

  const ensureNovelDocumentSaved = React.useCallback(async (): Promise<boolean> => {
    if (!selectedNovelDocumentPath || !novelDocumentDirty) return true

    const saveSeq = ++novelDocumentSaveSeqRef.current
    setNovelDocumentSaving(true)
    setNovelDocumentError(null)
    try {
      await window.electronAPI.writeFile(selectedNovelDocumentPath, novelDocumentContent)
      if (novelDocumentSaveSeqRef.current === saveSeq && latestNovelDocumentPathRef.current === selectedNovelDocumentPath) {
        setSavedNovelDocumentContent(novelDocumentContent)
      }
      void maybeCreateNovelAutoVersion(selectedNovelDocumentPath, novelDocumentContent)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save document'
      setNovelDocumentError(message)
      toast.error(t('writing.autoSaveFailed', 'Failed to save document'), { description: message })
      return false
    } finally {
      if (novelDocumentSaveSeqRef.current === saveSeq) {
        setNovelDocumentSaving(false)
      }
    }
  }, [maybeCreateNovelAutoVersion, novelDocumentContent, novelDocumentDirty, selectedNovelDocumentPath, t])

  const prepareNovelWorkspaceBriefForSend = React.useCallback(async (sessionId: string): Promise<NovelWorkspaceBriefPreparation> => {
    if (!novelWorkspaceRoot) return { shouldSend: true }

    const saved = await ensureNovelDocumentSaved()
    if (!saved) return { shouldSend: false }

    try {
      const snapshot = await window.electronAPI.createWorkspaceVersion(novelWorkspaceRoot, { reason: 'user-preprompt' })
      const headCommit = snapshot.commitHash
      if (!headCommit) return { shouldSend: true }

      const previousCommit = getKnownWorkspaceCommit(novelWorkspaceRoot, sessionId)
      if (!previousCommit || previousCommit === headCommit) {
        setKnownWorkspaceCommit(novelWorkspaceRoot, sessionId, headCommit)
        return { shouldSend: true }
      }

      const changedFiles = await window.electronAPI.compareWorkspaceVersions(novelWorkspaceRoot, previousCommit, headCommit)
      const agentTouchedPaths = new Set(novelAgentTouchedPathsRef.current[sessionId] ?? [])
      novelAgentTouchedPathsRef.current[sessionId] = []

      const unknownChanges = changedFiles.filter(change => !agentTouchedPaths.has(change.path))
      setKnownWorkspaceCommit(novelWorkspaceRoot, sessionId, headCommit)

      return {
        shouldSend: true,
        brief: buildNovelWorkspaceFreshnessBrief(unknownChanges, selectedNovelFile?.relativePath),
      }
    } catch (error) {
      console.warn('[writing] Failed to prepare workspace freshness brief:', error)
      return { shouldSend: true }
    }
  }, [ensureNovelDocumentSaved, novelWorkspaceRoot, selectedNovelFile?.relativePath])

  const checkpointNovelWorkspaceAgentTurn = React.useCallback(async (sessionId: string): Promise<void> => {
    if (!novelWorkspaceRoot || novelAgentTurnCheckpointInFlightRef.current) return

    novelAgentTouchedPathsRef.current[sessionId] = collectAgentTouchedRelativePaths(
      reviewableNovelFileChanges,
      novelWorkspaceRoot,
      novelWorkspaceFiles,
    )

    novelAgentTurnCheckpointInFlightRef.current = true
    try {
      await window.electronAPI.createWorkspaceVersion(novelWorkspaceRoot, { reason: 'agent-turn' })
      if (novelVersionDialogOpen) {
        await refreshNovelVersions()
      }
    } catch (error) {
      console.warn('[writing] Failed to create agent turn workspace version:', error)
    } finally {
      novelAgentTurnCheckpointInFlightRef.current = false
    }
  }, [novelVersionDialogOpen, novelWorkspaceFiles, novelWorkspaceRoot, refreshNovelVersions, reviewableNovelFileChanges])

  React.useEffect(() => {
    if (!effectiveSessionId || !novelWorkspaceRoot) return

    const isProcessing = effectiveSession?.isProcessing === true
    const wasProcessing = novelSessionProcessingRef.current[effectiveSessionId] === true
    novelSessionProcessingRef.current[effectiveSessionId] = isProcessing

    if (wasProcessing && !isProcessing) {
      void checkpointNovelWorkspaceAgentTurn(effectiveSessionId)
    }
  }, [checkpointNovelWorkspaceAgentTurn, effectiveSession?.isProcessing, effectiveSessionId, novelWorkspaceRoot])

  const syncSelectedNovelDocumentFromDisk = React.useCallback(async (filePath: string): Promise<boolean> => {
    if (selectedNovelFile?.path !== filePath) return true

    if (novelDocumentDirty) {
      toast.error(t(
        'writing.review.acceptBlockedByUnsavedEdits',
        'Save or discard your current edits before accepting this change.'
      ))
      return false
    }

    try {
      const content = await window.electronAPI.readFile(filePath)
      if (latestNovelDocumentPathRef.current !== filePath) return true

      setNovelDocumentContent(content)
      setSavedNovelDocumentContent(content)
      novelVersionBaselinesRef.current[filePath] ??= {
        content,
        timestamp: Date.now(),
      }
      return true
    } catch (error) {
      toast.error(t('writing.review.acceptFailed', 'Failed to accept this change'), {
        description: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }, [novelDocumentDirty, selectedNovelFile?.path, t])

  React.useEffect(() => {
    if (!selectedNovelDocumentPath || novelDocumentDirty || latestNovelFileChanges.length === 0) return

    const hasSelectedFileChange = reviewableNovelFileChanges.some(change =>
      !change.error && change.filePath === selectedNovelDocumentPath
    )
    if (!hasSelectedFileChange) return

    const timeoutId = window.setTimeout(() => {
      void syncSelectedNovelDocumentFromDisk(selectedNovelDocumentPath)
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    latestNovelFileChanges.length,
    novelDocumentDirty,
    reviewableNovelFileChanges,
    selectedNovelDocumentPath,
    syncSelectedNovelDocumentFromDisk,
  ])

  const handleCreateNovelVersion = React.useCallback(async () => {
    if (!novelWorkspaceRoot) return
    const saved = await ensureNovelDocumentSaved()
    if (!saved) return

    setNovelVersionSaving(true)
    try {
      const result = await window.electronAPI.createWorkspaceVersion(novelWorkspaceRoot, { reason: 'manual' })
      if (selectedNovelDocumentPath) {
        novelVersionBaselinesRef.current[selectedNovelDocumentPath] = {
          content: novelDocumentContent,
          timestamp: Date.now(),
        }
      }
      await refreshNovelVersions()
      toast.success(
        result.created
          ? t('writing.version.saved', '已保存当前版本')
          : t('writing.version.noChanges', '没有新的改动需要保存')
      )
    } catch (error) {
      toast.error(t('writing.version.saveFailed', '保存版本失败'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setNovelVersionSaving(false)
    }
  }, [ensureNovelDocumentSaved, novelDocumentContent, novelWorkspaceRoot, refreshNovelVersions, selectedNovelDocumentPath, t])

  const handleRestoreNovelVersion = React.useCallback(async (commitHash: string) => {
    if (!novelWorkspaceRoot) return
    const saved = await ensureNovelDocumentSaved()
    if (!saved) return

    setNovelVersionRestoringHash(commitHash)
    try {
      await window.electronAPI.restoreWorkspaceVersion(novelWorkspaceRoot, commitHash)
      novelVersionBaselinesRef.current = {}
      if (selectedNovelDocumentPath) {
        const content = await window.electronAPI.readFile(selectedNovelDocumentPath)
        setNovelDocumentContent(content)
        setSavedNovelDocumentContent(content)
        novelVersionBaselinesRef.current[selectedNovelDocumentPath] = {
          content,
          timestamp: Date.now(),
        }
      }
      await refreshNovelVersions()
      toast.success(t('writing.version.restored', '已恢复到所选版本'))
    } catch (error) {
      toast.error(t('writing.version.restoreFailed', '恢复版本失败'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setNovelVersionRestoringHash(null)
    }
  }, [ensureNovelDocumentSaved, novelWorkspaceRoot, refreshNovelVersions, selectedNovelDocumentPath, t])

  const handleExportNovelWorkspace = React.useCallback(async (options: NovelExportOptions) => {
    if (!novelWorkspaceRoot) return

    const saved = await ensureNovelDocumentSaved()
    if (!saved) return

    const plan = buildNovelExportPlan(novelWorkspaceFiles, options)
    if (plan.entries.length === 0) {
      toast.error(t('writing.export.empty', '没有可导出的内容'))
      return
    }

    const exportRootPath = joinWorkspacePath(novelWorkspaceRoot, createNovelExportFolderName())
    const toastId = toast.loading(t('writing.export.exporting', '正在导出'))
    setNovelExporting(true)

    try {
      await window.electronAPI.createDirectory(exportRootPath)

      for (const entry of plan.entries) {
        const targetPath = joinWorkspacePath(exportRootPath, entry.targetRelativePath)

        if (entry.kind === 'copy') {
          const content = await window.electronAPI.readFile(entry.sourcePath)
          await window.electronAPI.writeFile(targetPath, content)
          continue
        }

        const parts = await Promise.all(entry.sourcePaths.map(async (sourcePath) => ({
          sourcePath,
          content: await window.electronAPI.readFile(sourcePath),
        })))
        await window.electronAPI.writeFile(targetPath, buildMergedManuscriptContent(parts))
      }

      toast.success(t('writing.export.success', '已导出 {{count}} 个文件', { count: plan.sourceFileCount }), {
        id: toastId,
        description: exportRootPath,
        action: {
          label: t('writing.export.reveal', '显示'),
          onClick: () => { void window.electronAPI.showInFolder(exportRootPath).catch(() => {}) },
        },
      })
      setNovelExportDialogOpen(false)
    } catch (error) {
      toast.error(t('writing.export.failed', '导出写作工作区失败'), {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setNovelExporting(false)
    }
  }, [ensureNovelDocumentSaved, novelWorkspaceFiles, novelWorkspaceRoot, t])

  const [novelChangeReviewStatus, setNovelChangeReviewStatus] = React.useState<NovelReviewStatusMap>({})
  const novelReviewUndoStackRef = React.useRef<NovelReviewUndoEntry[]>([])

  React.useEffect(() => {
    if (!novelWorkspaceRoot) {
      setNovelChangeReviewStatus({})
      novelReviewUndoStackRef.current = []
      return
    }

    const saved = storage.get<Record<string, unknown>>(storage.KEYS.novelChangeReviewStatus, {}, novelWorkspaceRoot)
    setNovelChangeReviewStatus(parseNovelReviewStatusMap(saved))
    novelReviewUndoStackRef.current = []
  }, [novelWorkspaceRoot])

  React.useEffect(() => {
    if (!novelWorkspaceRoot || reviewableNovelFileChanges.length === 0) return

    setNovelChangeReviewStatus((current) => {
      const nextStatus = parseNovelReviewStatusMap(current, reviewableNovelFileChanges)
      storage.set(storage.KEYS.novelChangeReviewStatus, nextStatus, novelWorkspaceRoot)
      return nextStatus
    })
  }, [novelWorkspaceRoot, reviewableNovelFileChanges])

  const persistNovelChangeReviewStatus = React.useCallback((nextStatus: NovelReviewStatusMap) => {
    const normalizedStatus = parseNovelReviewStatusMap(nextStatus, reviewableNovelFileChanges)
    setNovelChangeReviewStatus(normalizedStatus)
    if (novelWorkspaceRoot) {
      storage.set(storage.KEYS.novelChangeReviewStatus, normalizedStatus, novelWorkspaceRoot)
    }
  }, [novelWorkspaceRoot, reviewableNovelFileChanges])

  const pushNovelReviewUndoEntry = React.useCallback((entry: NovelReviewUndoEntry | null | undefined) => {
    if (!entry || (entry.writes.length === 0 && Object.keys(entry.status).length === 0)) return

    novelReviewUndoStackRef.current.push(entry)
    if (novelReviewUndoStackRef.current.length > 20) {
      novelReviewUndoStackRef.current.shift()
    }
  }, [])

  const handleUndoNovelReviewAction = React.useCallback(async () => {
    const entry = novelReviewUndoStackRef.current.pop()
    if (!entry) return false

    if (novelDocumentDirty) {
      novelReviewUndoStackRef.current.push(entry)
      toast.error(t(
        'writing.review.undoBlockedByUnsavedEdits',
        'Save or discard your current edits before undoing the review action.'
      ))
      return true
    }

    try {
      for (const write of entry.writes) {
        await window.electronAPI.writeFile(write.filePath, write.content)
      }

      persistNovelChangeReviewStatus(entry.status)

      const selectedWrite = selectedNovelFile?.path
        ? entry.writes.find(write => write.filePath === selectedNovelFile.path)
        : undefined
      if (selectedWrite) {
        setNovelDocumentContent(selectedWrite.content)
        setSavedNovelDocumentContent(selectedWrite.content)
      }

      toast.success(t('writing.review.undone', 'Review action undone'))
      return true
    } catch (error) {
      novelReviewUndoStackRef.current.push(entry)
      toast.error(t('writing.review.undoFailed', 'Failed to undo review action'), {
        description: error instanceof Error ? error.message : String(error),
      })
      return true
    }
  }, [
    novelDocumentDirty,
    persistNovelChangeReviewStatus,
    selectedNovelFile?.path,
    t,
  ])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isNovelReviewUndoShortcut(event)) return
      if (novelReviewUndoStackRef.current.length === 0) return
      if (isTextEditingTarget(event.target)) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      void handleUndoNovelReviewAction()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleUndoNovelReviewAction])

  const pendingNovelChangedFilePaths = React.useMemo(
    () => getPendingChangedFilePaths(reviewableNovelFileChanges, novelChangeReviewStatus),
    [reviewableNovelFileChanges, novelChangeReviewStatus]
  )
  const selectedNovelPendingChanges = React.useMemo(
    () => getPendingChangesForFile(reviewableNovelFileChanges, novelChangeReviewStatus, selectedNovelFile?.path),
    [reviewableNovelFileChanges, novelChangeReviewStatus, selectedNovelFile?.path]
  )
  const selectedNovelReviewChange = selectedNovelPendingChanges[0]
  const selectedNovelReviewFileIndex = selectedNovelFile?.path
    ? pendingNovelChangedFilePaths.indexOf(selectedNovelFile.path)
    : -1
  const [dismissedNovelReviewDotKeys, setDismissedNovelReviewDotKeys] = React.useState<Set<string>>(() => new Set())
  const pendingNovelReviewDotKeysByPath = React.useMemo(() => {
    const keysByPath = new Map<string, string[]>()

    for (const change of reviewableNovelFileChanges) {
      if (change.error) continue
      const changeKey = getNovelReviewChangeKey(change)
      if (novelChangeReviewStatus[changeKey]) continue

      const keys = keysByPath.get(change.filePath) ?? []
      keys.push(changeKey)
      keysByPath.set(change.filePath, keys)
    }

    return keysByPath
  }, [novelChangeReviewStatus, reviewableNovelFileChanges])

  React.useEffect(() => {
    const pendingKeys = new Set<string>()
    for (const keys of pendingNovelReviewDotKeysByPath.values()) {
      for (const key of keys) pendingKeys.add(key)
    }

    setDismissedNovelReviewDotKeys((current) => {
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (pendingKeys.has(key)) {
          next.add(key)
        } else {
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [pendingNovelReviewDotKeysByPath])

  const hasNovelReviewDot = React.useCallback((filePath: string): boolean => {
    const keys = pendingNovelReviewDotKeysByPath.get(filePath)
    return !!keys?.some(key => !dismissedNovelReviewDotKeys.has(key))
  }, [dismissedNovelReviewDotKeys, pendingNovelReviewDotKeysByPath])

  const handleDismissNovelReviewDot = React.useCallback((filePath: string) => {
    const keys = pendingNovelReviewDotKeysByPath.get(filePath)
    if (!keys || keys.length === 0) return

    setDismissedNovelReviewDotKeys((current) => {
      const next = new Set(current)
      for (const key of keys) next.add(key)
      return next
    })
  }, [pendingNovelReviewDotKeysByPath])

  const handleAskAiForNovelSelection = React.useCallback(async ({ selectedText, instruction }: NovelSelectionAiRequest) => {
    if (!selectedNovelFile || !effectiveSessionId) {
      throw new Error('No active writing document or session')
    }
    const saved = await ensureNovelDocumentSaved()
    if (!saved) {
      throw new Error('Document was not saved')
    }

    try {
      const request = {
        filePath: selectedNovelFile.path,
        relativePath: selectedNovelFile.relativePath,
        selectedText,
        instruction,
      }
      if (typeof window.electronAPI.rewriteNovelSelection !== 'function') {
        const message = t(
          'writing.selectionRewrite.runtimeReloadRequired',
          'The selection rewrite runtime is out of date. Restarting the app to load the update.'
        )
        if (typeof window.electronAPI.relaunchApp === 'function') {
          toast.info(message)
          await window.electronAPI.relaunchApp()
        }
        throw new Error(message)
      }

      const result = await window.electronAPI.rewriteNovelSelection(effectiveSessionId, request)
      return result.replacement
    } catch (error) {
      toast.error(t('writing.selectionRewrite.failed', '改写选中文本失败'), {
        description: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }, [effectiveSessionId, ensureNovelDocumentSaved, selectedNovelFile, t])

  const handleAddNovelSelectionToChat = React.useCallback((message: string) => {
    if (!effectiveSessionId) return

    const currentDraft = getDraft(effectiveSessionId)
    const nextDraft = currentDraft.trim()
      ? `${currentDraft.trimEnd()}\n\n${message}`
      : message

    onInputChange(effectiveSessionId, nextDraft)
    window.dispatchEvent(new CustomEvent('craft:restore-input', {
      detail: { sessionId: effectiveSessionId, text: nextDraft },
    }))
    toast.success(t('writing.selectionContext.addedToChat', '已添加到对话框'))
  }, [effectiveSessionId, getDraft, onInputChange, t])

  const handleNovelWorkspaceSendMessage = React.useCallback<AppShellContextType['onSendMessage']>(async (
    sessionId,
    message,
    attachments,
    skillSlugs,
    badges,
    options,
  ) => {
    const preparation = sessionId === effectiveSessionId
      ? await prepareNovelWorkspaceBriefForSend(sessionId)
      : { shouldSend: true }
    if (!preparation.shouldSend) return

    onSendMessage(sessionId, message, attachments, skillSlugs, badges, {
      ...options,
      oneTimeContext: mergeOneTimeContext(options?.oneTimeContext, preparation.brief),
    })
  }, [effectiveSessionId, onSendMessage, prepareNovelWorkspaceBriefForSend])

  const handleSendNovelSelectionToChat = React.useCallback(async (message: string) => {
    if (!effectiveSessionId) return
    const saved = await ensureNovelDocumentSaved()
    if (!saved) return
    handleNovelWorkspaceSendMessage(effectiveSessionId, message)
  }, [effectiveSessionId, ensureNovelDocumentSaved, handleNovelWorkspaceSendMessage])

  const navigatorPanelWidth = showNovelDocumentNavigator
    ? novelWorkspaceNavigatorWidth
    : (showNovelWorkspacePending || showNovelWorkspaceUnavailable) ? novelWorkspaceNavigatorWidth : sessionListWidth
  const isNovelWorkspaceNavigatorActive = showNovelDocumentNavigator || showNovelWorkspacePending || showNovelWorkspaceUnavailable

  const handleNavigatorResizeBoundaryMouseDownCapture = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (effectiveSidebarAndNavigatorHidden || isAutoCompact || isResizing || e.button !== 0) return

    const navigatorPanelRect = navigatorPanelRef.current?.getBoundingClientRect()
    if (!navigatorPanelRect) return

    const boundaryCenter = navigatorPanelRect.right + (PANEL_GAP / 2)
    if (Math.abs(e.clientX - boundaryCenter) > NAVIGATOR_SASH_CAPTURE_HALF_WIDTH) return

    beginResize(isNovelWorkspaceNavigatorActive ? 'novel-workspace-navigator' : 'session-list', e)
  }, [
    beginResize,
    effectiveSidebarAndNavigatorHidden,
    isAutoCompact,
    isResizing,
    isNovelWorkspaceNavigatorActive,
  ])

  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSkills(activeWorkspaceId, activeSessionWorkingDirectory).then((loaded) => {
      setSkills(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load skills:', err)
    })
  }, [activeWorkspaceId, activeSessionWorkingDirectory])

  // Filter session metadata by active workspace
  // Also exclude hidden sessions (mini-agent sessions) from all counts and lists
  // For remote workspaces, sessions have the remote workspace ID (not the local one),
  // so we match against both the local and remote workspace IDs.
  const workspaceSessionMetas = useMemo(() => {
    const metas = Array.from(sessionMetaMap.values())
    if (!activeWorkspaceId) return metas.filter(s => !s.hidden)
    return metas.filter(s =>
      !s.hidden && (s.workspaceId === activeWorkspaceId || (remoteWorkspaceId && s.workspaceId === remoteWorkspaceId))
    )
  }, [sessionMetaMap, activeWorkspaceId, remoteWorkspaceId])

  // Active sessions exclude archived - use this for all counts and filters except archived view
  const activeSessionMetas = useMemo(() => {
    return workspaceSessionMetas.filter(s => !s.isArchived)
  }, [workspaceSessionMetas])

  const refreshWorkspaceUnreadMap = useCallback(async () => {
    try {
      const summary = await window.electronAPI.getUnreadSummary()
      const next: Record<string, boolean> = {}

      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }

      setWorkspaceUnreadMap(next)
    } catch (error) {
      console.error('[AppShell] Failed to refresh workspace unread indicators:', error)
    }
  }, [workspaces])

  // Initial + workspace-list refresh
  useEffect(() => {
    void refreshWorkspaceUnreadMap()
  }, [refreshWorkspaceUnreadMap])

  // Keep active workspace unread indicator in sync with live metadata updates
  useEffect(() => {
    if (!activeWorkspaceId) return
    const activeHasUnread = activeSessionMetas.some((session) => !!session.hasUnread)
    setWorkspaceUnreadMap((prev) => ({ ...prev, [activeWorkspaceId]: activeHasUnread }))
  }, [activeWorkspaceId, activeSessionMetas])

  // Keep cross-workspace indicators in sync with global unread updates from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onUnreadSummaryChanged((summary) => {
      const next: Record<string, boolean> = {}
      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }
      setWorkspaceUnreadMap(next)
    })

    return cleanup
  }, [workspaces])

  // Filter session metadata based on sidebar mode and chat filter
  const filteredSessionMetas = useMemo(() => {
    // When in sources mode, return empty (no sessions to show)
    if (!sessionFilter) {
      return []
    }

    let result: SessionMeta[]

    switch (sessionFilter.kind) {
      case 'allSessions':
        // "All Sessions" - shows active (non-archived) sessions
        result = activeSessionMetas
        break
      case 'flagged':
        result = activeSessionMetas.filter(s => s.isFlagged)
        break
      case 'archived':
        // Archived view shows only archived sessions
        result = workspaceSessionMetas.filter(s => s.isArchived)
        break
      case 'state':
        // Filter by specific todo state (excludes archived)
        result = activeSessionMetas.filter(s => (s.sessionStatus || 'todo') === sessionFilter.stateId)
        break
      case 'label': {
        if (sessionFilter.labelId === '__all__') {
          // "Labels" header: show all active sessions that have at least one label
          result = activeSessionMetas.filter(s => s.labels && s.labels.length > 0)
        } else {
          // Specific label: includes sessions tagged with this label or any descendant
          const descendants = getDescendantIds(labelConfigs, sessionFilter.labelId)
          const matchIds = new Set([sessionFilter.labelId, ...descendants])
          result = activeSessionMetas.filter(
            s => s.labels?.some(l => matchIds.has(extractLabelId(l)))
          )
        }
        break
      }
      case 'view': {
        // Filter by view: __all__ shows any session matched by any view,
        // otherwise filter to the specific view (excludes archived)
        result = activeSessionMetas.filter(s => {
          const matched = evaluateViews(s)
          if (sessionFilter.viewId === '__all__') {
            return matched.length > 0
          }
          return matched.some(v => v.id === sessionFilter.viewId)
        })
        break
      }
      default:
        result = activeSessionMetas
    }

    // Apply secondary filters (status + labels, AND-ed together) in ALL views.
    // These layer on top of the primary sessionFilter to allow further narrowing.
    // Each filter supports include/exclude modes:
    //   - Includes: if any exist, only matching items pass
    //   - Excludes: matching items are removed (applied after includes)
    if (listFilter.size > 0) {
      const statusIncludes = new Set<SessionStatusId>()
      const statusExcludes = new Set<SessionStatusId>()
      for (const [id, mode] of listFilter) {
        if (mode === 'include') statusIncludes.add(id)
        else statusExcludes.add(id)
      }
      if (statusIncludes.size > 0) {
        result = result.filter(s => statusIncludes.has((s.sessionStatus || 'todo') as SessionStatusId))
      }
      if (statusExcludes.size > 0) {
        result = result.filter(s => !statusExcludes.has((s.sessionStatus || 'todo') as SessionStatusId))
      }
    }
    // Filter by labels — supports include/exclude with descendant expansion
    if (labelFilter.size > 0) {
      const labelIncludes = new Set<string>()
      const labelExcludes = new Set<string>()
      for (const [id, mode] of labelFilter) {
        // Expand to include descendant label IDs
        const ids = [id, ...getDescendantIds(labelConfigs, id)]
        for (const expandedId of ids) {
          if (mode === 'include') labelIncludes.add(expandedId)
          else labelExcludes.add(expandedId)
        }
      }
      if (labelIncludes.size > 0) {
        result = result.filter(s =>
          s.labels?.some(l => labelIncludes.has(extractLabelId(l)))
        )
      }
      if (labelExcludes.size > 0) {
        result = result.filter(s =>
          !s.labels?.some(l => labelExcludes.has(extractLabelId(l)))
        )
      }
    }

    return result
  }, [workspaceSessionMetas, activeSessionMetas, sessionFilter, listFilter, labelFilter, labelConfigs])

  // Derive "pinned" (non-removable) filters from the current sessionFilter path.
  // These represent filters that are implicit in the current deeplink/route and
  // should be displayed as fixed chips in the filter bar that users cannot remove.
  const pinnedFilters = useMemo(() => {
    if (!sessionFilter) return { pinnedStatusId: null as string | null, pinnedLabelId: null as string | null, pinnedFlagged: false }
    switch (sessionFilter.kind) {
      case 'state':
        return { pinnedStatusId: sessionFilter.stateId, pinnedLabelId: null, pinnedFlagged: false }
      case 'label':
        // Don't pin the __all__ pseudo-label — that just means "any label"
        return { pinnedStatusId: null, pinnedLabelId: sessionFilter.labelId !== '__all__' ? sessionFilter.labelId : null, pinnedFlagged: false }
      case 'flagged':
        return { pinnedStatusId: null, pinnedLabelId: null, pinnedFlagged: true }
      default:
        return { pinnedStatusId: null, pinnedLabelId: null, pinnedFlagged: false }
    }
  }, [sessionFilter])

  // Ensure session messages are loaded when selected
  React.useEffect(() => {
    if (session.selected) {
      ensureMessagesLoaded(session.selected)
    }
  }, [session.selected, ensureMessagesLoaded])

  // Wrap delete handler to clear selection when deleting the currently selected session
  // This prevents stale state during re-renders that could cause crashes
  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation?: boolean): Promise<boolean> => {
    // Clear selection first if this is the selected session
    if (session.selected === sessionId) {
      setSession({ selected: null })
    }
    return onDeleteSession(sessionId, skipConfirmation)
  }, [session.selected, setSession, onDeleteSession])

  const mentionFiles = React.useMemo<MentionFileReference[]>(() => {
    return novelWorkspaceFiles.map(file => ({
      path: file.path,
      relativePath: file.relativePath,
      label: formatNovelWorkspaceFileTitle(file, t),
      type: 'file',
      description: file.relativePath,
    }))
  }, [novelWorkspaceFiles, t])

  // Extend context value with local overrides (wrapped onDeleteSession, sources, skills, labels, enabledModes, rightSidebarOpenButton, effectiveSessionStatuses)
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    onSendMessage: handleNovelWorkspaceSendMessage,
    enabledSources: sources,
    skills,
    mentionFiles,
    activeSessionWorkingDirectory,
    labels: displayLabelConfigs,
    onSessionLabelsChange: handleSessionLabelsChange,
    enabledModes,
    sessionStatuses: effectiveSessionStatuses,
    onSessionSourcesChange: handleSessionSourcesChange,
    rightSidebarButton: null,
    isCompactMode: isAutoCompact,
    // Search state for ChatDisplay highlighting
    sessionListSearchQuery: searchActive ? searchQuery : undefined,
    isSearchModeActive: searchActive,
    chatDisplayRef,
    onChatMatchInfoChange: handleChatMatchInfoChange,
    onTestAutomation: handleTestAutomation,
    onToggleAutomation: handleToggleAutomation,
    onDuplicateAutomation: handleDuplicateAutomation,
    onDeleteAutomation: handleDeleteAutomation,
    automationTestResults,
    getAutomationHistory,
    onReplayAutomation: handleReplayAutomation,
  }), [contextValue, handleDeleteSession, handleNovelWorkspaceSendMessage, sources, skills, mentionFiles, activeSessionWorkingDirectory, displayLabelConfigs, handleSessionLabelsChange, enabledModes, effectiveSessionStatuses, handleSessionSourcesChange, isAutoCompact, searchActive, searchQuery, handleChatMatchInfoChange, handleTestAutomation, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, automationTestResults, getAutomationHistory, handleReplayAutomation])

  // Persist expanded folders to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.expandedFolders, [...expandedFolders], activeWorkspaceId)
  }, [expandedFolders, activeWorkspaceId])

  // Persist sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.sidebarVisible, isSidebarVisible)
  }, [isSidebarVisible])

  // Persist focus mode state to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.focusModeEnabled, isSidebarAndNavigatorHidden)
  }, [isSidebarAndNavigatorHidden])

  // Listen for focus mode toggle from menu (View → Focus Mode)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleFocusMode?.(() => {
      setIsSidebarAndNavigatorHidden(v => !v)
    })
    return cleanup
  }, [])

  // Listen for sidebar toggle from menu (View → Toggle Sidebar)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleSidebar?.(() => {
      handleToggleSidebar()
    })
    return cleanup
  }, [handleToggleSidebar])

  // Persist per-view filter map to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.viewFilters, viewFiltersMap, activeWorkspaceId)
  }, [viewFiltersMap, activeWorkspaceId])

  // Persist sidebar section collapsed states (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.collapsedSidebarItems, [...collapsedItems], activeWorkspaceId)
  }, [collapsedItems, activeWorkspaceId])

  const handleAllSessionsClick = useCallback(() => {
    navigate(routes.view.allSessions())
  }, [])

  const handleSelectNovelFile = React.useCallback(async (file: NovelWorkspaceFile) => {
    if (file.path !== selectedNovelFile?.path) {
      const saved = await ensureNovelDocumentSaved()
      if (!saved) return
    }
    setSelectedNovelFilePath(file.path)
    handleAllSessionsClick()
  }, [ensureNovelDocumentSaved, handleAllSessionsClick, selectedNovelFile?.path])

  const handleSelectNovelFileByPath = React.useCallback(async (filePath: string | null) => {
    if (!filePath) return
    const file = novelWorkspaceFiles.find(item => item.path === filePath)
    if (!file) {
      onOpenFile(filePath)
      return
    }
    await handleSelectNovelFile(file)
  }, [handleSelectNovelFile, novelWorkspaceFiles, onOpenFile])

  const handleSelectAdjacentNovelChangeFile = React.useCallback(async (direction: 'next' | 'previous') => {
    const targetPath = getAdjacentChangedFilePath(
      pendingNovelChangedFilePaths,
      selectedNovelFile?.path,
      direction
    )
    await handleSelectNovelFileByPath(targetPath)
  }, [handleSelectNovelFileByPath, pendingNovelChangedFilePaths, selectedNovelFile?.path])

  const handleSelectNextNovelChangeAfterStatus = React.useCallback(async (
    change: FileChange,
    nextStatus: NovelReviewStatusMap
  ) => {
    const nextPendingPaths = getPendingChangedFilePaths(reviewableNovelFileChanges, nextStatus)
    if (nextPendingPaths.length === 0) return

    const currentIndex = pendingNovelChangedFilePaths.indexOf(change.filePath)
    const searchOrder = currentIndex >= 0
      ? [
          ...pendingNovelChangedFilePaths.slice(currentIndex + 1),
          ...pendingNovelChangedFilePaths.slice(0, currentIndex + 1),
        ]
      : nextPendingPaths
    const targetPath = searchOrder.find(path => nextPendingPaths.includes(path)) ?? nextPendingPaths[0]
    await handleSelectNovelFileByPath(targetPath)
  }, [handleSelectNovelFileByPath, pendingNovelChangedFilePaths, reviewableNovelFileChanges])

  const handleAcceptNovelChange = React.useCallback(async (change: FileChange) => {
    if (change.error) {
      toast.error(t('writing.review.acceptUnavailable', 'Cannot accept a failed change.'))
      return
    }

    const synced = await syncSelectedNovelDocumentFromDisk(change.filePath)
    if (!synced) return

    let undoEntry: NovelReviewUndoEntry | undefined
    try {
      const currentContent = await window.electronAPI.readFile(change.filePath)
      const undo = buildAcceptNovelChangeUndoEntry(change, currentContent, novelChangeReviewStatus)
      if (undo.ok) {
        undoEntry = undo.entry
      }
    } catch (error) {
      console.warn('[writing] Failed to capture accept undo entry:', error)
    }

    const changeKey = getNovelReviewChangeKey(change)
    const nextStatus = {
      ...novelChangeReviewStatus,
      [changeKey]: 'accepted' as const,
    }
    persistNovelChangeReviewStatus(nextStatus)
    pushNovelReviewUndoEntry(undoEntry)
    void handleSelectNextNovelChangeAfterStatus(change, nextStatus)
    toast.success(t('writing.review.accepted', 'Change accepted'), undoEntry ? {
      action: {
        label: t('common.undo', 'Undo'),
        onClick: () => { void handleUndoNovelReviewAction() },
      },
    } : undefined)
  }, [
    handleUndoNovelReviewAction,
    handleSelectNextNovelChangeAfterStatus,
    novelChangeReviewStatus,
    persistNovelChangeReviewStatus,
    pushNovelReviewUndoEntry,
    syncSelectedNovelDocumentFromDisk,
    t,
  ])

  const handleAcceptAllNovelChanges = React.useCallback(async () => {
    const selectedPendingChange = selectedNovelFile?.path
      ? reviewableNovelFileChanges.find(change =>
          !change.error
          && change.filePath === selectedNovelFile.path
          && !novelChangeReviewStatus[getNovelReviewChangeKey(change)]
        )
      : undefined
    if (selectedPendingChange) {
      const synced = await syncSelectedNovelDocumentFromDisk(selectedPendingChange.filePath)
      if (!synced) return
    }

    const nextStatus: NovelReviewStatusMap = { ...novelChangeReviewStatus }
    let undoStatus: NovelReviewStatusMap = { ...novelChangeReviewStatus }
    const undoContentByPath = new Map<string, string>()
    for (const change of reviewableNovelFileChanges) {
      if (change.error) continue
      const changeKey = getNovelReviewChangeKey(change)
      if (nextStatus[changeKey]) continue

      try {
        const currentContent = undoContentByPath.get(change.filePath)
          ?? await window.electronAPI.readFile(change.filePath)
        const undo = buildAcceptNovelChangeUndoEntry(change, currentContent, undoStatus)
        if (undo.ok) {
          undoStatus = undo.entry.status
          const write = undo.entry.writes[0]
          if (write) {
            undoContentByPath.set(write.filePath, write.content)
          }
        }
      } catch (error) {
        console.warn('[writing] Failed to capture accept-all undo entry:', error)
      }

      nextStatus[changeKey] = 'accepted'
    }

    persistNovelChangeReviewStatus(nextStatus)
    const undoEntry: NovelReviewUndoEntry | undefined = undoContentByPath.size > 0
      ? {
          status: undoStatus,
          writes: Array.from(undoContentByPath, ([filePath, content]) => ({ filePath, content })),
        }
      : undefined
    pushNovelReviewUndoEntry(undoEntry)
    toast.success(t('writing.review.acceptedAll', 'All changes accepted'), undoEntry ? {
      action: {
        label: t('common.undo', 'Undo'),
        onClick: () => { void handleUndoNovelReviewAction() },
      },
    } : undefined)
  }, [
    handleUndoNovelReviewAction,
    novelChangeReviewStatus,
    persistNovelChangeReviewStatus,
    pushNovelReviewUndoEntry,
    reviewableNovelFileChanges,
    selectedNovelFile?.path,
    syncSelectedNovelDocumentFromDisk,
    t,
  ])

  const handleRejectNovelChange = React.useCallback(async (change: FileChange) => {
    if (selectedNovelFile?.path === change.filePath) {
      const saved = await ensureNovelDocumentSaved()
      if (!saved) return
    }

    try {
      const currentContent = await window.electronAPI.readFile(change.filePath)
      const rejected = buildRejectedFileContent(change, currentContent)
      if (!rejected.ok) {
        toast.error(t('writing.review.rejectUnavailable', 'Cannot safely reject this change'), {
          description: rejected.reason,
        })
        return
      }

      const undoEntry = buildRejectNovelChangeUndoEntry(change, currentContent, novelChangeReviewStatus)
      await window.electronAPI.writeFile(change.filePath, rejected.content)
      const changeKey = getNovelReviewChangeKey(change)
      const nextStatus = {
        ...novelChangeReviewStatus,
        [changeKey]: 'rejected' as const,
      }
      persistNovelChangeReviewStatus(nextStatus)
      pushNovelReviewUndoEntry(undoEntry)

      if (selectedNovelFile?.path === change.filePath) {
        setNovelDocumentContent(rejected.content)
        setSavedNovelDocumentContent(rejected.content)
      }

      void handleSelectNextNovelChangeAfterStatus(change, nextStatus)
      toast.success(t('writing.review.rejected', 'Change rejected'), {
        action: {
          label: t('common.undo', 'Undo'),
          onClick: () => { void handleUndoNovelReviewAction() },
        },
      })
    } catch (error) {
      toast.error(t('writing.review.rejectFailed', 'Failed to reject this change'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [
    ensureNovelDocumentSaved,
    handleUndoNovelReviewAction,
    handleSelectNextNovelChangeAfterStatus,
    novelChangeReviewStatus,
    persistNovelChangeReviewStatus,
    pushNovelReviewUndoEntry,
    selectedNovelFile?.path,
    t,
  ])

  const handleFlaggedClick = useCallback(() => {
    navigate(routes.view.flagged())
  }, [])

  const handleArchivedClick = useCallback(() => {
    navigate(routes.view.archived())
  }, [])

  // Handler for individual todo state views
  const handleSessionStatusClick = useCallback((stateId: SessionStatusId) => {
    navigate(routes.view.state(stateId))
  }, [])

  // Handler for label filter views (hierarchical — includes descendant labels)
  const handleLabelClick = useCallback((labelId: string) => {
    navigate(routes.view.label(labelId))
  }, [])

  const handleViewClick = useCallback((viewId: string) => {
    navigate(routes.view.view(viewId))
  }, [])

  // DnD handler: reorder statuses (flat list drag-and-drop)
  // Sets optimistic order immediately for instant UI feedback, then fires IPC.
  const handleStatusReorder = useCallback((orderedIds: string[]) => {
    if (!activeWorkspaceId) return
    setOptimisticStatusOrder(orderedIds)
    window.electronAPI.reorderStatuses(activeWorkspaceId, orderedIds)
  }, [activeWorkspaceId])

  // Handler for sources view (all sources)
  const handleSourcesClick = useCallback(() => {
    navigate(routes.view.sources())
  }, [])

  // Handlers for source type filter views (subcategories in Sources dropdown)
  const handleSourcesApiClick = useCallback(() => {
    navigate(routes.view.sourcesApi())
  }, [])

  const handleSourcesMcpClick = useCallback(() => {
    navigate(routes.view.sourcesMcp())
  }, [])

  const handleSourcesLocalClick = useCallback(() => {
    navigate(routes.view.sourcesLocal())
  }, [])

  // Handler for skills view
  const handleSkillsClick = useCallback(() => {
    navigate(routes.view.skills())
  }, [])

  // Handlers for automations view
  const handleAutomationsClick = useCallback(() => {
    navigate(routes.view.automations())
  }, [])

  const handleAutomationsScheduledClick = useCallback(() => {
    navigate(routes.view.automationsScheduled())
  }, [])

  const handleAutomationsEventClick = useCallback(() => {
    navigate(routes.view.automationsEvent())
  }, [])

  const handleAutomationsAgenticClick = useCallback(() => {
    navigate(routes.view.automationsAgentic())
  }, [])

  // Handler for settings view
  const handleSettingsClick = useCallback((subpage: SettingsSubpage = 'app') => {
    navigate(routes.view.settings(subpage))
  }, [])

  // Handler for What's New overlay
  const handleWhatsNewClick = useCallback(async () => {
    const content = await window.electronAPI.getReleaseNotes()
    setReleaseNotesContent(content)
    setShowWhatsNew(true)
    setHasUnseenReleaseNotes(false)
    // Update last seen version
    const latestVersion = await window.electronAPI.getLatestReleaseVersion()
    if (latestVersion) {
      storage.set(storage.KEYS.whatsNewLastSeenVersion, latestVersion)
    }
  }, [])

  // Create a new chat and select it
  const handleNewChat = useCallback((newPanel: boolean = false) => {
    if (!activeWorkspace) return

    // Exit search mode and switch to All Sessions
    setSearchActive(false)
    setSearchQuery('')

    // Delegate to NavigationContext which handles session creation
    navigate(
      routes.action.newSession(),
      newPanel ? { newPanel: true, targetLaneId: 'main' } : undefined
    )

    // Focus the chat input after navigation completes
    setTimeout(() => focusZone('chat', { intent: 'programmatic' }), 50)
  }, [activeWorkspace, focusZone, navigate])

  // Create a brand new dedicated browser window and focus it.
  // Intentionally unbound: this action should always create a NEW window.
  const handleNewBrowserWindow = useCallback(async () => {
    try {
      const instanceId = await window.electronAPI.browserPane.create({
        show: true,
      })
      await window.electronAPI.browserPane.focus(instanceId)
    } catch (error) {
      console.error('[Chat] Failed to create browser window:', error)
      toast.error(t('toast.failedToCreateBrowser'))
    }
  }, [])

  // Delete Source - simplified since agents system is removed
  const handleDeleteSource = useCallback(async (sourceSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSource(activeWorkspace.id, sourceSlug)
      toast.success(t('toast.deletedSource'))
    } catch (error) {
      console.error('[Chat] Failed to delete source:', error)
      toast.error(t('toast.failedToDeleteSource'))
    }
  }, [activeWorkspace])

  // Delete Skill
  const handleDeleteSkill = useCallback(async (skillSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSkill(activeWorkspace.id, skillSlug)
      toast.success(t('toast.deletedSkill', { slug: skillSlug }))
    } catch (error) {
      console.error('[Chat] Failed to delete skill:', error)
      toast.error(t('toast.failedToDeleteSkill'))
    }
  }, [activeWorkspace])

  // Respond to menu bar "New Chat" trigger
  const menuTriggerRef = useRef(menuNewChatTrigger)
  useEffect(() => {
    // Skip initial render
    if (menuTriggerRef.current === menuNewChatTrigger) return
    menuTriggerRef.current = menuNewChatTrigger
    handleNewChat()
  }, [menuNewChatTrigger, handleNewChat])

  const novelWorkspaceSidebarLinks = React.useMemo((): LeftSidebarItem[] => {
    if (!showNovelWorkspaceSidebar) return []

    const manuscriptSection: {
      id: NovelWorkspaceFileSectionId
      title: string
      icon: LeftSidebarLinkItem['icon']
      files: NovelWorkspaceFile[]
    } = { id: 'manuscript', title: t('writing.tabs.manuscript'), icon: BookOpenText, files: novelWorkspaceTree.manuscript.files }
    const freeAreaSection: {
      id: NovelWorkspaceFileSectionId
      title: string
      icon: LeftSidebarLinkItem['icon']
      files: NovelWorkspaceFile[]
    } = { id: 'work', title: t('writing.catalog.freeArea', '自由区'), icon: Layers, files: novelWorkspaceTree.work.files }

    const globalSectionDefinitions: Array<{
      id: NovelWorkspaceFileSectionId
      title: string
      icon: LeftSidebarLinkItem['icon']
      files: NovelWorkspaceFile[]
    }> = [
      { id: 'outline', title: t('writing.tabs.outline'), icon: ScrollText, files: novelWorkspaceTree.outline.files },
      { id: 'characters', title: t('writing.tabs.characters'), icon: UsersRound, files: novelWorkspaceTree.characters.files },
      { id: 'style', title: t('writing.tabs.style', 'Style'), icon: Palette, files: novelWorkspaceTree.style.files },
      ...(novelWorkspaceTree.analysis.files.length > 0 ? [
        { id: 'analysis' as const, title: t('writing.tabs.analysis', 'Analysis'), icon: Search, files: novelWorkspaceTree.analysis.files },
      ] : []),
      ...(!isShortFormNovelWorkspace ? [
        { id: 'locations' as const, title: t('writing.tabs.locations'), icon: MapPinned, files: novelWorkspaceTree.locations.files },
        { id: 'timeline' as const, title: t('writing.tabs.timeline'), icon: Calendar, files: novelWorkspaceTree.timeline.files },
        { id: 'state' as const, title: t('writing.tabs.state'), icon: ListTodo, files: novelWorkspaceTree.state.files },
      ] : []),
    ]

    const fileItem = (file: NovelWorkspaceFile): LeftSidebarItem => ({
      id: `writing:file:${file.path}`,
      title: formatNovelWorkspaceFileTitle(file, t),
      tooltip: file.relativePath,
      icon: FileText,
      variant: file.path === selectedNovelFile?.path ? 'default' : 'ghost',
      compact: true,
      reviewDot: hasNovelReviewDot(file.path) ? {
        title: t('writing.review.changedFile', 'Changed file'),
        onDismiss: () => handleDismissNovelReviewDot(file.path),
      } : undefined,
      onClick: () => {
        handleSelectNovelFile(file)
      },
    })

    const createNovelWorkspaceFileActions = (
      basePath: NovelCreateFileBasePath,
      target: Omit<NovelCreateFileTarget, 'basePath'>,
      importTitle: string
    ) => {
      const menuTitle = `${importTitle} / ${target.title}`

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <span
              role="button"
              tabIndex={-1}
              title={menuTitle}
              aria-label={menuTitle}
              className="ml-1 flex h-4 w-4 items-center justify-center rounded-[4px] text-foreground/45 hover:bg-foreground/10 hover:text-foreground data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground"
              data-no-dnd="true"
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <MoreHorizontal className="h-3 w-3" />
            </span>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" sideOffset={4} className="min-w-[9.5rem]">
            <StyledDropdownMenuItem
              onClick={(event) => {
                event.stopPropagation()
                void handleImportNovelFiles(basePath)
              }}
            >
              <FileUp className="h-3.5 w-3.5" />
              {importTitle}
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem
              onClick={(event) => {
                event.stopPropagation()
                openNovelCreateFileDialog({ basePath, ...target })
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {target.title}
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )
    }

    const sectionItem = (section: typeof globalSectionDefinitions[number]): LeftSidebarItem => {
      const sectionId = `writing:section:${section.id}`
      const hasSelectedFile = section.files.some(file => file.path === selectedNovelFile?.path)

      return {
        id: sectionId,
        title: section.title,
        label: String(section.files.length),
        icon: section.icon,
        variant: hasSelectedFile ? 'default' : 'ghost',
        expandable: true,
        expanded: isExpanded(sectionId),
        onToggle: () => toggleExpanded(sectionId),
        onClick: () => {
          const firstFile = section.files[0]
          if (firstFile) {
            handleSelectNovelFile(firstFile)
          }
        },
        items: section.files.map(fileItem),
      }
    }

    const visibleGlobalSectionDefinitions = isShortFormNovelWorkspace
      ? globalSectionDefinitions.filter(section => section.files.length > 0)
      : globalSectionDefinitions
    const visibleGlobalSectionItems = visibleGlobalSectionDefinitions.map(sectionItem)
    const shortFormGlobalInfoFiles = getShortFormGlobalInfoFiles(novelWorkspaceTree)
    const globalItems = isShortFormNovelWorkspace
      ? shortFormGlobalInfoFiles.map(fileItem)
      : visibleGlobalSectionItems
    const globalFileCount = isShortFormNovelWorkspace
      ? shortFormGlobalInfoFiles.length
      : visibleGlobalSectionDefinitions.reduce((count, section) => count + section.files.length, 0)
    const hasSelectedGlobalFile = isShortFormNovelWorkspace
      ? shortFormGlobalInfoFiles.some(file => file.path === selectedNovelFile?.path)
      : visibleGlobalSectionDefinitions.some(section =>
        section.files.some(file => file.path === selectedNovelFile?.path)
      )
    const hasSelectedManuscriptFile = manuscriptSection.files.some(file => file.path === selectedNovelFile?.path)
    const hasSelectedFreeAreaFile = freeAreaSection.files.some(file => file.path === selectedNovelFile?.path)
    const manuscriptGroupId = 'writing:group:manuscript'
    const freeAreaGroupId = 'writing:group:free-area'

    return [{
      id: 'nav:writingCatalog',
      title: t('writing.workspace'),
      label: String(novelWorkspaceFiles.length),
      icon: Library,
      variant: 'ghost',
      expandable: true,
      expanded: isExpanded('nav:writingCatalog'),
      onToggle: () => toggleExpanded('nav:writingCatalog'),
      onClick: () => toggleExpanded('nav:writingCatalog'),
      items: [
        {
          id: 'writing:group:global',
          title: t('writing.catalog.globalInfo', '全局信息'),
          label: String(globalFileCount),
          icon: Library,
          variant: hasSelectedGlobalFile ? 'default' : 'ghost',
          expandable: true,
          expanded: isExpanded('writing:group:global'),
          onToggle: () => toggleExpanded('writing:group:global'),
          onClick: () => toggleExpanded('writing:group:global'),
          items: globalItems,
        },
        {
          id: manuscriptGroupId,
          title: manuscriptSection.title,
          label: String(manuscriptSection.files.length),
          icon: manuscriptSection.icon,
          variant: hasSelectedManuscriptFile ? 'default' : 'ghost',
          afterTitle: createNovelWorkspaceFileActions(
            '正文',
            {
              title: t('writing.createFile.manuscript', '新建正文文件'),
              placeholder: '07-标题、07-标题.md 或 第一卷/07-标题.txt',
              initialValue: '',
            },
            t('writing.importFile.manuscript', '导入正文文件')
          ),
          expandable: true,
          expanded: isExpanded(manuscriptGroupId),
          onToggle: () => toggleExpanded(manuscriptGroupId),
          onClick: () => {
            const firstFile = manuscriptSection.files[0]
            if (firstFile) {
              handleSelectNovelFile(firstFile)
            } else {
              toggleExpanded(manuscriptGroupId)
            }
          },
          items: manuscriptSection.files.map(fileItem),
        },
        {
          id: freeAreaGroupId,
          title: freeAreaSection.title,
          label: String(freeAreaSection.files.length),
          icon: freeAreaSection.icon,
          variant: hasSelectedFreeAreaFile ? 'default' : 'ghost',
          afterTitle: createNovelWorkspaceFileActions(
            '自由区',
            {
              title: t('writing.createFile.freeArea', '新建自由区文件'),
              placeholder: '脑洞、脑洞.md 或 临时/脑洞.txt',
              initialValue: '',
            },
            t('writing.importFile.freeArea', '导入自由区文件')
          ),
          expandable: true,
          expanded: isExpanded(freeAreaGroupId),
          onToggle: () => toggleExpanded(freeAreaGroupId),
          onClick: () => {
            const firstFile = freeAreaSection.files[0]
            if (firstFile) {
              handleSelectNovelFile(firstFile)
            } else {
              toggleExpanded(freeAreaGroupId)
            }
          },
          items: freeAreaSection.files.map(fileItem),
        },
      ],
    }]
  }, [
    handleSelectNovelFile,
    handleDismissNovelReviewDot,
    hasNovelReviewDot,
    handleImportNovelFiles,
    isExpanded,
    isShortFormNovelWorkspace,
    novelWorkspaceFiles,
    novelWorkspaceTree,
    openNovelCreateFileDialog,
    selectedNovelFile?.path,
    showNovelWorkspaceSidebar,
    t,
    toggleExpanded,
  ])

  const novelWorkspaceUtilitySidebarLinks = React.useMemo((): LeftSidebarItem[] => {
    if (!showNovelWorkspaceSidebar) return []

    return [
      {
        id: "nav:sources",
        title: t("sidebar.sources"),
        label: String(sources.length),
        icon: DatabaseZap,
        variant: (isSourcesNavigation(navState) && !sourceFilter) ? "default" : "ghost",
        onClick: handleSourcesClick,
        dataTutorial: "sources-nav",
      },
      {
        id: "nav:skills",
        title: t("sidebar.skills"),
        label: String(skills.length),
        icon: Zap,
        variant: isSkillsNavigation(navState) ? "default" : "ghost",
        onClick: handleSkillsClick,
      },
      {
        id: "nav:automations",
        title: t("sidebar.automations"),
        label: String(automations.length),
        icon: ListTodo,
        variant: (isAutomationsNavigation(navState) && !automationFilter) ? "default" : "ghost",
        onClick: handleAutomationsClick,
      },
      { id: "separator:writing-settings", type: "separator" },
      {
        id: "nav:settings",
        title: t("sidebar.settings"),
        icon: Settings,
        variant: isSettingsNavigation(navState) ? "default" : "ghost",
        onClick: () => handleSettingsClick('app'),
      },
      {
        id: "nav:writing-version",
        title: t('writing.version.title', '版本管理'),
        icon: History,
        variant: "ghost" as const,
        onClick: () => setNovelVersionDialogOpen(true),
      },
    ]
  }, [
    automationFilter,
    automations.length,
    handleAutomationsClick,
    handleSettingsClick,
    handleSkillsClick,
    handleSourcesClick,
    navState,
    showNovelWorkspaceSidebar,
    skills.length,
    sourceFilter,
    sources.length,
    t,
  ])

  const primarySidebarLinks = React.useMemo(
    () => {
      const links = getPrimarySidebarLinks(novelWorkspaceSidebarLinks)
      return links.length > 0 ? links : (showNovelWorkspacePending || showNovelWorkspaceUnavailable) ? [
        {
          id: 'writing:loading',
          title: t('writing.workspace'),
          icon: Library,
          variant: 'default' as const,
          onClick: () => {},
        },
      ] : []
    },
    [novelWorkspaceSidebarLinks, showNovelWorkspacePending, showNovelWorkspaceUnavailable, t]
  )
  const hasPrimarySidebar = primarySidebarLinks.length > 0

  // Unified sidebar items: nav buttons only (agents system removed)
  type SidebarItem = {
    id: string
    type: 'nav'
    action?: () => void
  }

  const unifiedSidebarItems = React.useMemo((): SidebarItem[] => {
    const result: SidebarItem[] = []

    if (primarySidebarLinks.length > 0) {
      const rootItem = primarySidebarLinks[0]
      result.push({ id: 'nav:writingCatalog', type: 'nav', action: rootItem && !('type' in rootItem) ? rootItem.onClick : undefined })
      for (const item of primarySidebarLinks) {
        if ('items' in item && item.items) {
          for (const section of item.items) {
            if ('type' in section) continue
            result.push({ id: section.id, type: 'nav', action: section.onClick })
            for (const child of section.items ?? []) {
              if ('type' in child) continue
              result.push({ id: child.id, type: 'nav', action: child.onClick })
            }
          }
        }
      }
      result.push({ id: 'nav:sources', type: 'nav', action: handleSourcesClick })
      result.push({ id: 'nav:skills', type: 'nav', action: handleSkillsClick })
      result.push({ id: 'nav:automations', type: 'nav', action: handleAutomationsClick })
      result.push({ id: 'nav:settings', type: 'nav', action: () => handleSettingsClick('app') })
      result.push({ id: 'nav:writing-version', type: 'nav', action: () => setNovelVersionDialogOpen(true) })
      return result
    }

    return result
  }, [handleAutomationsClick, handleSettingsClick, handleSkillsClick, handleSourcesClick, primarySidebarLinks])

  // Toggle folder expanded state
  const handleToggleFolder = React.useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // Get props for any sidebar item (unified roving tabindex pattern)
  const getSidebarItemProps = React.useCallback((id: string) => ({
    tabIndex: focusedSidebarItemId === id ? 0 : -1,
    'data-focused': focusedSidebarItemId === id,
    ref: (el: HTMLElement | null) => {
      if (el) {
        sidebarItemRefs.current.set(id, el)
      } else {
        sidebarItemRefs.current.delete(id)
      }
    },
  }), [focusedSidebarItemId])

  // Unified sidebar keyboard navigation
  const handleSidebarKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (!sidebarFocused || unifiedSidebarItems.length === 0) return

    const currentIndex = unifiedSidebarItems.findIndex(item => item.id === focusedSidebarItemId)
    const currentItem = currentIndex >= 0 ? unifiedSidebarItems[currentIndex] : null

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const nextIndex = currentIndex < unifiedSidebarItems.length - 1 ? currentIndex + 1 : 0
        const nextItem = unifiedSidebarItems[nextIndex]
        setFocusedSidebarItemId(nextItem.id)
        sidebarItemRefs.current.get(nextItem.id)?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : unifiedSidebarItems.length - 1
        const prevItem = unifiedSidebarItems[prevIndex]
        setFocusedSidebarItemId(prevItem.id)
        sidebarItemRefs.current.get(prevItem.id)?.focus()
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        // At boundary - do nothing (Left doesn't change zones from sidebar)
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        // Move to next zone (navigator) - keyboard navigation
        focusZone('navigator', { intent: 'keyboard' })
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (currentItem?.type === 'nav' && currentItem.action) {
          currentItem.action()
        }
        break
      }
      case 'Home': {
        e.preventDefault()
        if (unifiedSidebarItems.length > 0) {
          const firstItem = unifiedSidebarItems[0]
          setFocusedSidebarItemId(firstItem.id)
          sidebarItemRefs.current.get(firstItem.id)?.focus()
        }
        break
      }
      case 'End': {
        e.preventDefault()
        if (unifiedSidebarItems.length > 0) {
          const lastItem = unifiedSidebarItems[unifiedSidebarItems.length - 1]
          setFocusedSidebarItemId(lastItem.id)
          sidebarItemRefs.current.get(lastItem.id)?.focus()
        }
        break
      }
    }
  }, [sidebarFocused, unifiedSidebarItems, focusedSidebarItemId, focusZone])

  // Focus sidebar item when sidebar zone gains focus
  React.useEffect(() => {
    if (sidebarFocused && unifiedSidebarItems.length > 0) {
      // Set focused item if not already set
      const itemId = focusedSidebarItemId || unifiedSidebarItems[0].id
      if (!focusedSidebarItemId) {
        setFocusedSidebarItemId(itemId)
      }
      // Actually focus the DOM element
      requestAnimationFrame(() => {
        sidebarItemRefs.current.get(itemId)?.focus()
      })
    }
  }, [sidebarFocused, focusedSidebarItemId, unifiedSidebarItems])

  // Get title based on navigation state
  const listTitle = React.useMemo(() => {
    // Sources navigator
    if (isSourcesNavigation(navState)) {
      return t("sidebar.sources")
    }

    // Skills navigator
    if (isSkillsNavigation(navState)) {
      return t("sidebar.allSkills")
    }

    // Automations navigator
    if (isAutomationsNavigation(navState)) {
      if (!automationFilter) return t("sidebar.allAutomations")
      switch (automationFilter.automationType) {
        case 'scheduled': return t("sidebar.scheduled")
        case 'event': return t("sidebar.eventBased")
        case 'agentic': return t("sidebar.agentic")
        default: return t("sidebar.allAutomations")
      }
    }

    // Settings navigator
    if (isSettingsNavigation(navState)) return t("sidebar.settings")

    // Sessions navigator - use sessionFilter
    if (!sessionFilter) return t("sidebar.allSessions")

    switch (sessionFilter.kind) {
      case 'flagged':
        return t("sidebar.flagged")
      case 'state': {
        const state = effectiveSessionStatuses.find(s => s.id === sessionFilter.stateId)
        return state ? t(`status.${state.id}`, state.label) : t("sidebar.allSessions")
      }
      case 'label':
        return sessionFilter.labelId === '__all__' ? t("sidebar.labels") : getLabelDisplayName(labelConfigs, sessionFilter.labelId)
      case 'view':
        return sessionFilter.viewId === '__all__' ? t("sidebar.views") : viewConfigs.find(v => v.id === sessionFilter.viewId)?.name || t("sidebar.views")
      default:
        return t("sidebar.allSessions")
    }
  }, [navState, t, sessionFilter, automationFilter, labelConfigs, viewConfigs, effectiveSessionStatuses])

  return (
    <AppShellProvider value={appShellContextValue}>
        {/* === TOP BAR === */}
        <TopBar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          workspaceUnreadMap={workspaceUnreadMap}
          onWorkspaceCreated={(workspace) => onWorkspaceCreated?.(workspace) ?? onRefreshWorkspaces?.()}
          onWorkspaceRemoved={() => onRefreshWorkspaces?.()}
          activeSessionId={effectiveSessionId}
          onNewChat={() => handleNewChat()}
          onNewWindow={() => window.electronAPI.menuNewWindow()}
          onOpenSettings={onOpenSettings}
          onOpenSettingsSubpage={handleSettingsClick}
          onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
          onOpenStoredUserPreferences={onOpenStoredUserPreferences}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onToggleSidebar={handleToggleSidebar}
          onToggleFocusMode={() => setIsSidebarAndNavigatorHidden(prev => !prev)}
          onAddSessionPanel={() => handleNewChat(true)}
          onAddBrowserPanel={() => { void handleNewBrowserWindow() }}
          onOpenGlobalSearch={() => setGlobalSearchOpen(true)}
          workspaceTools={showNovelWorkspaceSidebar ? (
            <NovelWorkspaceUtilityTopNav
              links={novelWorkspaceUtilitySidebarLinks}
              getItemProps={getSidebarItemProps}
              focusedItemId={focusedSidebarItemId}
            />
          ) : undefined}
          rightTools={showNovelWorkspaceSidebar ? (
            <div className="flex items-center gap-1">
              <HeaderIconButton
                icon={<History className="h-4 w-4" />}
                tooltip={t('writing.version.title', '版本管理')}
                disabled={!novelWorkspaceRoot}
                onClick={() => setNovelVersionDialogOpen(true)}
                className="h-[26px] w-[26px] rounded-lg"
              />
              <HeaderIconButton
                icon={<Download className="h-4 w-4" />}
                tooltip={t('writing.export.action', '导出')}
                disabled={novelWorkspaceFiles.length === 0}
                onClick={() => setNovelExportDialogOpen(true)}
                className="h-[26px] w-[26px] rounded-lg"
              />
            </div>
          ) : undefined}
          isCompact={isAutoCompact}
        />

      {/* === OUTER LAYOUT: Unified Panel Stack | Right Sidebar === */}
      <div
        ref={shellRef}
        onMouseDownCapture={handleNavigatorResizeBoundaryMouseDownCapture}
        className="flex items-stretch relative"
        style={{ height: '100%', paddingRight: PANEL_EDGE_INSET, paddingBottom: PANEL_EDGE_INSET, paddingLeft: 0, gap: PANEL_GAP }}
      >
        <PanelStackContainer
          sidebarSlot={
            <div
              ref={sidebarRef}
              style={{ width: sidebarWidth }}
              className="h-full font-sans relative"
              data-focus-zone="sidebar"
              tabIndex={sidebarFocused ? 0 : -1}
              onKeyDown={handleSidebarKeyDown}
            >
            <div className="flex h-full flex-col select-none">
              {/* Sidebar Top Section */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* Primary Nav: workspace directory catalog */}
                {/* pb-4 provides clearance so the last item scrolls above the mask-fade-bottom gradient */}
                <div className="flex-1 overflow-y-auto min-h-0 mask-fade-bottom pb-4">
                <LeftSidebar
                  isCollapsed={false}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={primarySidebarLinks}
                />
                {/* Agent Tree: Hierarchical list of agents */}
                {/* Agents section removed */}
                </div>
              </div>

            </div>
          </div>
          }
          sidebarWidth={effectiveSidebarAndNavigatorHidden ? 0 : (isSidebarVisible && hasPrimarySidebar ? sidebarWidth : 0)}
          navigatorSlot={
            <div
              ref={navigatorPanelRef}
              style={{ width: isAutoCompact ? '100%' : navigatorPanelWidth }}
              className="h-full flex flex-col min-w-0 relative z-panel"
            >
            {showNovelDocumentNavigator && novelWorkspaceRoot ? (
              <NovelDocumentEditorPanel
                file={selectedNovelFile}
                content={novelDocumentContent}
                loading={novelDocumentLoading}
                saving={novelDocumentSaving}
                error={novelDocumentError}
                onChange={setNovelDocumentContent}
                onAskAiForSelection={handleAskAiForNovelSelection}
                onAddSelectionToChat={handleAddNovelSelectionToChat}
                onSendSelectionToChat={handleSendNovelSelectionToChat}
                reviewChange={selectedNovelReviewChange}
                pendingChangeCount={pendingNovelChangedFilePaths.length}
                pendingFileIndex={selectedNovelReviewFileIndex >= 0 ? selectedNovelReviewFileIndex : undefined}
                onAcceptReviewChange={selectedNovelReviewChange ? () => handleAcceptNovelChange(selectedNovelReviewChange) : undefined}
                onAcceptAllReviewChanges={pendingNovelChangedFilePaths.length > 0 ? handleAcceptAllNovelChanges : undefined}
                onRejectReviewChange={selectedNovelReviewChange ? () => { void handleRejectNovelChange(selectedNovelReviewChange) } : undefined}
                onPreviousReviewFile={() => { void handleSelectAdjacentNovelChangeFile('previous') }}
                onNextReviewFile={() => { void handleSelectAdjacentNovelChangeFile('next') }}
              />
            ) : showNovelWorkspacePending ? (
              <div className="flex h-full flex-col">
                <PanelHeader
                  title={isSidebarVisible ? t('writing.workspace') : undefined}
                  compensateForStoplight={!isSidebarVisible}
                />
                <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
                  {t('writing.loadingWorkspace', '正在加载项目目录...')}
                </div>
              </div>
            ) : showNovelWorkspaceUnavailable ? (
              <div className="flex h-full flex-col">
                <PanelHeader
                  title={isSidebarVisible ? t('writing.workspace') : undefined}
                  compensateForStoplight={!isSidebarVisible}
                />
                <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
                  {t('writing.workspaceUnavailable', '未检测到项目目录')}
                </div>
              </div>
            ) : (
              <>
            <PanelHeader
              title={isSidebarVisible ? listTitle : undefined}
              compensateForStoplight={!isSidebarVisible}
              badge={automationFilter?.automationType === 'scheduled' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground/50 cursor-default flex items-center titlebar-no-drag">
                      <Info className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px]">
                    Scheduling requires your machine to be running. It can be locked, but must be powered on.
                  </TooltipContent>
                </Tooltip>
              ) : undefined}
              actions={
                <>
                  {/* Filter dropdown - available in ALL chat views.
                      Shows user-added filters (removable) and pinned filters (non-removable, derived from route).
                      Pinned filters: state views pin a status, label views pin a label, flagged pins the flag. */}
                  {isSessionsNavigation(navState) && (
                    <DropdownMenu onOpenChange={(open) => { if (!open) { setFilterDropdownQuery(''); setFilterAltHeld(false) } }}>
                      <DropdownMenuTrigger asChild>
                        <HeaderIconButton
                          icon={<ListFilter className="h-4 w-4" />}
                          className={(listFilter.size > 0 || labelFilter.size > 0) ? "bg-accent/5 text-accent rounded-[8px] shadow-tinted" : "rounded-[8px]"}
                          style={(listFilter.size > 0 || labelFilter.size > 0) ? { '--shadow-color': 'var(--accent-rgb)' } as React.CSSProperties : undefined}
                        />
                      </DropdownMenuTrigger>
                      <StyledDropdownMenuContent
                        align="end"
                        light
                        minWidth="min-w-[200px]"
                        onKeyDown={(e: React.KeyboardEvent) => {
                          if (e.key === 'Alt') setFilterAltHeld(true)
                          // When on the first menu item and pressing Up, refocus the search input
                          if (e.key === 'ArrowUp' && !filterDropdownQuery.trim()) {
                            const menu = (e.target as HTMLElement).closest('[role="menu"]')
                            const items = menu?.querySelectorAll('[role="menuitem"]')
                            if (items && items.length > 0 && document.activeElement === items[0]) {
                              e.preventDefault()
                              e.stopPropagation()
                              filterDropdownInputRef.current?.focus()
                            }
                          }
                        }}
                        onKeyUp={(e: React.KeyboardEvent) => {
                          if (e.key === 'Alt') setFilterAltHeld(false)
                        }}
                      >
                        {/* Header with title and clear button (only clears user-added filters, never pinned) */}
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <span className="text-xs font-medium text-muted-foreground">{t("sidebar.filterChats")}</span>
                          {(listFilter.size > 0 || labelFilter.size > 0) && (
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                setListFilter(new Map())
                                setLabelFilter(new Map())
                              }}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Clear
                            </button>
                          )}
                        </div>

                        {/* Search input — typing switches from hierarchical submenus to a flat filtered list.
                            stopPropagation prevents Radix from intercepting keys. Arrow/Enter handled for navigation. */}
                        <div className="px-1 pb-3 border-b border-foreground/5">
                          <div className="bg-background rounded-[6px] shadow-minimal px-2 py-1.5">
                            <input
                              ref={filterDropdownInputRef}
                              type="text"
                              value={filterDropdownQuery}
                              onChange={(e) => setFilterDropdownQuery(e.target.value)}
                              onKeyDown={(e) => {
                                // When input is empty, let ArrowDown/ArrowUp blur the input
                                // so Radix's native menu keyboard navigation takes over
                                if (!filterDropdownQuery.trim() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                                  e.preventDefault()
                                  ;(e.target as HTMLInputElement).blur()
                                  // Focus the first menu item so Radix's keyboard navigation activates
                                  const menu = (e.target as HTMLElement).closest('[role="menu"]')
                                  const firstItem = menu?.querySelector('[role="menuitem"]') as HTMLElement | null
                                  firstItem?.focus()
                                  return
                                }
                                e.stopPropagation()
                                const { states: ms, labels: ml } = filterDropdownResults
                                const total = ms.length + ml.length
                                if (total === 0) return
                                switch (e.key) {
                                  case 'ArrowDown':
                                    e.preventDefault()
                                    setFilterDropdownSelectedIdx(prev => (prev < total - 1 ? prev + 1 : 0))
                                    break
                                  case 'ArrowUp':
                                    e.preventDefault()
                                    setFilterDropdownSelectedIdx(prev => (prev > 0 ? prev - 1 : total - 1))
                                    break
                                  case 'Enter': {
                                    e.preventDefault()
                                    const mode: FilterMode = e.altKey ? 'exclude' : 'include'
                                    const idx = filterDropdownSelectedIdx
                                    if (idx < ms.length) {
                                      // Toggle a status filter
                                      const state = ms[idx]
                                      if (state.id !== pinnedFilters.pinnedStatusId) {
                                        setListFilter(prev => {
                                          const next = new Map(prev)
                                          if (next.has(state.id)) next.delete(state.id)
                                          else next.set(state.id, mode)
                                          return next
                                        })
                                      }
                                    } else {
                                      // Toggle a label filter
                                      const item = ml[idx - ms.length]
                                      if (item && item.id !== pinnedFilters.pinnedLabelId) {
                                        setLabelFilter(prev => {
                                          const next = new Map(prev)
                                          if (next.has(item.id)) next.delete(item.id)
                                          else next.set(item.id, mode)
                                          return next
                                        })
                                      }
                                    }
                                    break
                                  }
                                }
                              }}
                              placeholder={t("sidebar.searchStatusesLabels")}
                              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                              autoFocus
                            />
                          </div>
                        </div>

                        {/* ── Conditional body: hierarchical (no query) vs flat filtered list (has query) ── */}
                        {filterDropdownQuery.trim() === '' ? (
                          <>
                            {/* === HIERARCHICAL MODE (default) === */}

                            {/* Active filter chips: pinned (non-removable) + user-added (removable) */}
                            {(pinnedFilters.pinnedFlagged || pinnedFilters.pinnedStatusId || pinnedFilters.pinnedLabelId || listFilter.size > 0 || labelFilter.size > 0) && (
                              <>
                                {/* Pinned: flagged */}
                                {pinnedFilters.pinnedFlagged && (
                                  <StyledDropdownMenuItem disabled>
                                    <FilterMenuRow
                                      icon={<Flag className="h-3.5 w-3.5" />}
                                      label={t("sidebar.flagged")}
                                      accessory={<Check className="h-3 w-3 text-muted-foreground" />}
                                    />
                                  </StyledDropdownMenuItem>
                                )}
                                {/* Pinned: status from state view */}
                                {(() => {
                                  if (!pinnedFilters.pinnedStatusId) return null
                                  const state = effectiveSessionStatuses.find(s => s.id === pinnedFilters.pinnedStatusId)
                                  if (!state) return null
                                  return (
                                    <StyledDropdownMenuItem disabled key={`pinned-status-${state.id}`}>
                                      <FilterMenuRow
                                        icon={state.icon}
                                        label={state.label}
                                        accessory={<Check className="h-3 w-3 text-muted-foreground" />}
                                        iconStyle={state.iconColorable ? { color: state.resolvedColor } : undefined}
                                        noIconContainer
                                      />
                                    </StyledDropdownMenuItem>
                                  )
                                })()}
                                {/* Pinned: label from label view */}
                                {(() => {
                                  if (!pinnedFilters.pinnedLabelId) return null
                                  const label = findLabelById(labelConfigs, pinnedFilters.pinnedLabelId)
                                  if (!label) return null
                                  return (
                                    <StyledDropdownMenuItem disabled key={`pinned-label-${label.id}`}>
                                      <FilterMenuRow
                                        icon={<LabelIcon label={label} size="lg" />}
                                        label={label.name}
                                        accessory={<Check className="h-3 w-3 text-muted-foreground" />}
                                      />
                                    </StyledDropdownMenuItem>
                                  )
                                })()}
                                {/* User-added: selected statuses with mode pill (include/exclude) */}
                                {effectiveSessionStatuses.filter(s => listFilter.has(s.id)).map(state => {
                                  const applyColor = state.iconColorable
                                  const mode = listFilter.get(state.id)!
                                  return (
                                    <DropdownMenuSub key={`sel-status-${state.id}`}>
                                      <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); setListFilter(prev => { const next = new Map(prev); next.delete(state.id); return next }) }}>
                                        <FilterMenuRow
                                          icon={state.icon}
                                          label={state.label}
                                          accessory={<FilterModeBadge mode={mode} />}
                                          iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                          noIconContainer
                                        />
                                      </StyledDropdownMenuSubTrigger>
                                      <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                                        <FilterModeSubMenuItems
                                          mode={mode}
                                          onChangeMode={(newMode) => setListFilter(prev => {
                                            const next = new Map(prev)
                                            next.set(state.id, newMode)
                                            return next
                                          })}
                                          onRemove={() => setListFilter(prev => {
                                            const next = new Map(prev)
                                            next.delete(state.id)
                                            return next
                                          })}
                                        />
                                      </StyledDropdownMenuSubContent>
                                    </DropdownMenuSub>
                                  )
                                })}
                                {/* User-added: selected labels with mode pill (include/exclude) */}
                                {Array.from(labelFilter).map(([labelId, mode]) => {
                                  const label = findLabelById(labelConfigs, labelId)
                                  if (!label) return null
                                  return (
                                    <DropdownMenuSub key={`sel-label-${labelId}`}>
                                      <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); setLabelFilter(prev => { const next = new Map(prev); next.delete(labelId); return next }) }}>
                                        <FilterMenuRow
                                          icon={<LabelIcon label={label} size="lg" />}
                                          label={label.name}
                                          accessory={<FilterModeBadge mode={mode} />}
                                        />
                                      </StyledDropdownMenuSubTrigger>
                                      <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                                        <FilterModeSubMenuItems
                                          mode={mode}
                                          onChangeMode={(newMode) => setLabelFilter(prev => {
                                            const next = new Map(prev)
                                            next.set(labelId, newMode)
                                            return next
                                          })}
                                          onRemove={() => setLabelFilter(prev => {
                                            const next = new Map(prev)
                                            next.delete(labelId)
                                            return next
                                          })}
                                        />
                                      </StyledDropdownMenuSubContent>
                                    </DropdownMenuSub>
                                  )
                                })}
                                <StyledDropdownMenuSeparator />
                              </>
                            )}

                            {/* Statuses submenu - hierarchical with toggle selection */}
                            <DropdownMenuSub>
                              <StyledDropdownMenuSubTrigger>
                                <Inbox className="h-3.5 w-3.5" />
                                <span className="flex-1">{t("sidebar.statuses")}</span>
                              </StyledDropdownMenuSubTrigger>
                              <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                                {effectiveSessionStatuses.map(state => {
                                  const applyColor = state.iconColorable
                                  const isPinned = state.id === pinnedFilters.pinnedStatusId
                                  const currentMode = listFilter.get(state.id)
                                  const isActive = !!currentMode && !isPinned
                                  // Active status → DropdownMenuSub with mode options (Radix safe-triangle hover)
                                  if (isActive) {
                                    return (
                                      <DropdownMenuSub key={state.id}>
                                        <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); setListFilter(prev => { const next = new Map(prev); next.delete(state.id); return next }) }}>
                                          <FilterMenuRow
                                            icon={state.icon}
                                            label={state.label}
                                            accessory={<FilterModeBadge mode={currentMode} />}
                                            iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                            noIconContainer
                                          />
                                        </StyledDropdownMenuSubTrigger>
                                        <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                                          <FilterModeSubMenuItems
                                            mode={currentMode}
                                            onChangeMode={(newMode) => setListFilter(prev => {
                                              const next = new Map(prev)
                                              next.set(state.id, newMode)
                                              return next
                                            })}
                                            onRemove={() => setListFilter(prev => {
                                              const next = new Map(prev)
                                              next.delete(state.id)
                                              return next
                                            })}
                                          />
                                        </StyledDropdownMenuSubContent>
                                      </DropdownMenuSub>
                                    )
                                  }
                                  // Inactive / pinned status → simple toggleable item
                                  return (
                                    <AltExcludeTooltip key={state.id} show={filterAltHeld && !isPinned}>
                                      <StyledDropdownMenuItem
                                        disabled={isPinned}
                                        onClick={(e) => {
                                          if (isPinned) return
                                          e.preventDefault()
                                          setListFilter(prev => {
                                            const next = new Map(prev)
                                            if (next.has(state.id)) next.delete(state.id)
                                            else next.set(state.id, e.altKey ? 'exclude' : 'include')
                                            return next
                                          })
                                        }}
                                      >
                                        <FilterMenuRow
                                          icon={state.icon}
                                          label={state.label}
                                          accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : null}
                                          iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                          noIconContainer
                                        />
                                      </StyledDropdownMenuItem>
                                    </AltExcludeTooltip>
                                  )
                                })}
                              </StyledDropdownMenuSubContent>
                            </DropdownMenuSub>

                            {/* Labels submenu - hierarchical tree with recursive submenus */}
                            <DropdownMenuSub>
                              <StyledDropdownMenuSubTrigger>
                                <Tag className="h-3.5 w-3.5" />
                                <span className="flex-1">{t("sidebar.labels")}</span>
                              </StyledDropdownMenuSubTrigger>
                              <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                                {labelConfigs.length === 0 ? (
                                  <StyledDropdownMenuItem disabled>
                                    <span className="text-muted-foreground">{t("table.noLabelsConfigured")}</span>
                                  </StyledDropdownMenuItem>
                                ) : (
                                  <FilterLabelItems
                                    labels={displayLabelConfigs}
                                    labelFilter={labelFilter}
                                    setLabelFilter={setLabelFilter}
                                    pinnedLabelId={pinnedFilters.pinnedLabelId}
                                    altHeld={filterAltHeld}
                                  />
                                )}
                              </StyledDropdownMenuSubContent>
                            </DropdownMenuSub>

                            {/* Group by submenu - hidden in state sub-views (always date there) */}
                            {!isStateSubView && (
                              <>
                                <StyledDropdownMenuSeparator />
                                <DropdownMenuSub>
                                  <StyledDropdownMenuSubTrigger>
                                    <Layers className="h-3.5 w-3.5" />
                                    <span className="flex-1">{t("sidebar.group")}</span>
                                  </StyledDropdownMenuSubTrigger>
                                  <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                                    <StyledDropdownMenuItem onClick={() => setChatGroupingMode('date')}>
                                      <Calendar className="h-3.5 w-3.5" />
                                      <span className="flex-1">{t("sidebar.groupByDate")}</span>
                                      {chatGroupingMode === 'date' && <Check className="h-3 w-3 text-muted-foreground" />}
                                    </StyledDropdownMenuItem>
                                    <StyledDropdownMenuItem onClick={() => setChatGroupingMode('status')}>
                                      <Inbox className="h-3.5 w-3.5" />
                                      <span className="flex-1">{t("sidebar.groupByStatus")}</span>
                                      {chatGroupingMode === 'status' && <Check className="h-3 w-3 text-muted-foreground" />}
                                    </StyledDropdownMenuItem>
                                    <StyledDropdownMenuItem onClick={() => setChatGroupingMode('unread')}>
                                      <MailOpen className="h-3.5 w-3.5" />
                                      <span className="flex-1">{t("sidebar.groupByUnread")}</span>
                                      {chatGroupingMode === 'unread' && <Check className="h-3 w-3 text-muted-foreground" />}
                                    </StyledDropdownMenuItem>
                                  </StyledDropdownMenuSubContent>
                                </DropdownMenuSub>
                              </>
                            )}

                            <StyledDropdownMenuSeparator />
                            <StyledDropdownMenuItem
                              onClick={() => {
                                setSearchActive(true)
                              }}
                            >
                              <Search className="h-3.5 w-3.5" />
                              <span className="flex-1">{t("sidebar.search")}</span>
                            </StyledDropdownMenuItem>
                          </>
                        ) : (
                          <>
                            {/* === FLAT FILTERED MODE (has query) ===
                                Uses the same filter/score logic as the # inline menu.
                                Shows matching statuses and labels in a single flat list.
                                Supports keyboard navigation (ArrowUp/Down/Enter in input). */}
                            {filterDropdownResults.states.length === 0 && filterDropdownResults.labels.length === 0 ? (
                              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                No matching statuses or labels
                              </div>
                            ) : (
                              <div ref={filterDropdownListRef} className="max-h-[240px] overflow-y-auto py-1">
                                {/* Matched statuses */}
                                {filterDropdownResults.states.length > 0 && (
                                  <>
                                    <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                                      Statuses
                                    </div>
                                    {filterDropdownResults.states.map((state, index) => {
                                      const applyColor = state.iconColorable
                                      const isPinned = state.id === pinnedFilters.pinnedStatusId
                                      const currentMode = listFilter.get(state.id)
                                      const isHighlighted = index === filterDropdownSelectedIdx
                                      const isActive = !!currentMode && !isPinned
                                      // Active status → DropdownMenuSub with mode options
                                      if (isActive) {
                                        return (
                                          <DropdownMenuSub key={`flat-status-${state.id}`}>
                                            <StyledDropdownMenuSubTrigger
                                              data-filter-selected={isHighlighted}
                                              onMouseEnter={() => setFilterDropdownSelectedIdx(index)}
                                              className={cn("mx-1", isHighlighted && "bg-foreground/5")}
                                              onClick={(e) => { e.preventDefault(); setListFilter(prev => { const next = new Map(prev); next.delete(state.id); return next }) }}
                                            >
                                              <FilterMenuRow
                                                icon={state.icon}
                                                label={state.label}
                                                accessory={<FilterModeBadge mode={currentMode} />}
                                                iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                                noIconContainer
                                              />
                                            </StyledDropdownMenuSubTrigger>
                                            <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                                              <FilterModeSubMenuItems
                                                mode={currentMode}
                                                onChangeMode={(newMode) => setListFilter(prev => {
                                                  const next = new Map(prev)
                                                  next.set(state.id, newMode)
                                                  return next
                                                })}
                                                onRemove={() => setListFilter(prev => {
                                                  const next = new Map(prev)
                                                  next.delete(state.id)
                                                  return next
                                                })}
                                              />
                                            </StyledDropdownMenuSubContent>
                                          </DropdownMenuSub>
                                        )
                                      }
                                      // Inactive / pinned status → plain div with click-to-toggle
                                      return (
                                        <AltExcludeTooltip key={`flat-status-${state.id}`} show={filterAltHeld && !isPinned}>
                                          <div
                                            data-filter-selected={isHighlighted}
                                            onMouseEnter={() => setFilterDropdownSelectedIdx(index)}
                                            onClick={(e) => {
                                              if (isPinned) return
                                              e.preventDefault()
                                              setListFilter(prev => {
                                                const next = new Map(prev)
                                                if (next.has(state.id)) next.delete(state.id)
                                                else next.set(state.id, e.altKey ? 'exclude' : 'include')
                                                return next
                                              })
                                            }}
                                            className={cn(
                                              // SVG sizing matches StyledDropdownMenuSubTrigger so icons render at the same size
                                              "flex cursor-pointer select-none items-center gap-2 rounded-[4px] mx-1 px-2 py-1.5 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
                                              isHighlighted && "bg-foreground/5",
                                              isPinned && "opacity-50 pointer-events-none",
                                            )}
                                          >
                                            <FilterMenuRow
                                              icon={state.icon}
                                              label={state.label}
                                              accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : null}
                                              iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                              noIconContainer
                                            />
                                          </div>
                                        </AltExcludeTooltip>
                                      )
                                    })}
                                  </>
                                )}
                                {/* Separator between sections */}
                                {filterDropdownResults.states.length > 0 && filterDropdownResults.labels.length > 0 && (
                                  <div className="my-1 mx-2 border-t border-border/40" />
                                )}
                                {/* Matched labels — flat list with parent breadcrumbs */}
                                {filterDropdownResults.labels.length > 0 && (
                                  <>
                                    <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                                      Labels
                                    </div>
                                    {filterDropdownResults.labels.map((item, index) => {
                                      // Offset by state count for unified index
                                      const flatIndex = filterDropdownResults.states.length + index
                                      const isPinned = item.id === pinnedFilters.pinnedLabelId
                                      const currentMode = labelFilter.get(item.id)
                                      const isHighlighted = flatIndex === filterDropdownSelectedIdx
                                      const isActive = !!currentMode && !isPinned
                                      const labelDisplay = item.parentPath
                                        ? <><span className="text-muted-foreground">{item.parentPath}</span>{item.label}</>
                                        : item.label
                                      // Active label → DropdownMenuSub with mode options
                                      if (isActive) {
                                        return (
                                          <DropdownMenuSub key={`flat-label-${item.id}`}>
                                            <StyledDropdownMenuSubTrigger
                                              data-filter-selected={isHighlighted}
                                              onMouseEnter={() => setFilterDropdownSelectedIdx(flatIndex)}
                                              className={cn("mx-1", isHighlighted && "bg-foreground/5")}
                                              onClick={(e) => { e.preventDefault(); setLabelFilter(prev => { const next = new Map(prev); next.delete(item.id); return next }) }}
                                            >
                                              <FilterMenuRow
                                                icon={<LabelIcon label={item.config} size="lg" />}
                                                label={labelDisplay}
                                                accessory={<FilterModeBadge mode={currentMode} />}
                                              />
                                            </StyledDropdownMenuSubTrigger>
                                            <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                                              <FilterModeSubMenuItems
                                                mode={currentMode}
                                                onChangeMode={(newMode) => setLabelFilter(prev => {
                                                  const next = new Map(prev)
                                                  next.set(item.id, newMode)
                                                  return next
                                                })}
                                                onRemove={() => setLabelFilter(prev => {
                                                  const next = new Map(prev)
                                                  next.delete(item.id)
                                                  return next
                                                })}
                                              />
                                            </StyledDropdownMenuSubContent>
                                          </DropdownMenuSub>
                                        )
                                      }
                                      // Inactive / pinned label → plain div with click-to-toggle
                                      return (
                                        <AltExcludeTooltip key={`flat-label-${item.id}`} show={filterAltHeld && !isPinned}>
                                          <div
                                            data-filter-selected={isHighlighted}
                                            onMouseEnter={() => setFilterDropdownSelectedIdx(flatIndex)}
                                            onClick={(e) => {
                                              if (isPinned) return
                                              e.preventDefault()
                                              setLabelFilter(prev => {
                                                const next = new Map(prev)
                                                if (next.has(item.id)) next.delete(item.id)
                                                else next.set(item.id, e.altKey ? 'exclude' : 'include')
                                                return next
                                              })
                                            }}
                                            className={cn(
                                              // SVG sizing matches StyledDropdownMenuSubTrigger so icons render at the same size
                                              "flex cursor-pointer select-none items-center gap-2 rounded-[4px] mx-1 px-2 py-1.5 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
                                              isHighlighted && "bg-foreground/5",
                                              isPinned && "opacity-50 pointer-events-none",
                                            )}
                                          >
                                            <FilterMenuRow
                                              icon={<LabelIcon label={item.config} size="lg" />}
                                              label={labelDisplay}
                                              accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : null}
                                            />
                                          </div>
                                        </AltExcludeTooltip>
                                      )
                                    })}
                                  </>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </StyledDropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {/* Add Source button (only for sources mode) - uses filter-aware edit config */}
                  {isSourcesNavigation(navState) && activeWorkspace && (
                    <EditPopover
                      trigger={
                        <HeaderIconButton
                          icon={<Plus className="h-4 w-4" />}
                          tooltip={t("sidebarMenu.addSource")}
                          data-tutorial="add-source-button"
                        />
                      }
                      {...getEditConfig(
                        sourceFilter?.kind === 'type' ? `add-source-${sourceFilter.sourceType}` as EditContextKey : 'add-source',
                        activeWorkspace.rootPath
                      )}
                    />
                  )}
                  {/* Add Skill button (only for skills mode) */}
                  {isSkillsNavigation(navState) && activeWorkspace && (
                    <EditPopover
                      trigger={
                        <HeaderIconButton
                          icon={<Plus className="h-4 w-4" />}
                          tooltip={t("sidebarMenu.addSkill")}
                          data-tutorial="add-skill-button"
                        />
                      }
                      {...getEditConfig('add-skill', activeWorkspace.rootPath)}
                    />
                  )}
                  {/* Add Automation button (only for automations mode) */}
                  {isAutomationsNavigation(navState) && activeWorkspace && (
                    <EditPopover
                      trigger={
                        <HeaderIconButton
                          icon={<Plus className="h-4 w-4" />}
                          tooltip={t("sidebarMenu.addAutomation")}
                        />
                      }
                      {...getEditConfig('automation-config', activeWorkspace.rootPath)}
                    />
                  )}
                </>
              }
            />
            {/* Content: SessionList, SourcesListPanel, or SettingsNavigator based on navigation state */}
            {isSourcesNavigation(navState) && (
              /* Sources List - filtered by type if sourceFilter is active */
              <SourcesListPanel
                sources={sources}
                sourceFilter={sourceFilter}
                workspaceId={activeWorkspaceId ?? undefined}
                workspaceRootPath={activeWorkspace?.rootPath}
                onDeleteSource={handleDeleteSource}
                onSourceClick={handleSourceSelect}
                selectedSourceSlug={isSourcesNavigation(navState) && navState.details ? navState.details.sourceSlug : null}
                localMcpEnabled={localMcpEnabled}
              />
            )}
            {isSkillsNavigation(navState) && activeWorkspaceId && (
              /* Skills List */
              <SkillsListPanel
                skills={skills}
                workspaceId={activeWorkspaceId}
                workspaceRootPath={activeWorkspace?.rootPath}
                onSkillClick={handleSkillSelect}
                onDeleteSkill={handleDeleteSkill}
                selectedSkillSlug={isSkillsNavigation(navState) && navState.details?.type === 'skill' ? navState.details.skillSlug : null}
              />
            )}
            {isAutomationsNavigation(navState) && (
              /* Automations List - filtered by type if automationFilter is active */
              <AutomationsListPanel
                automations={automations}
                automationFilter={automationFilter ? { kind: AUTOMATION_TYPE_TO_FILTER_KIND[automationFilter.automationType] ?? 'all' } : undefined}
                onAutomationClick={handleAutomationSelect}
                onTestAutomation={handleTestAutomation}
                onToggleAutomation={handleToggleAutomation}
                onDuplicateAutomation={handleDuplicateAutomation}
                onDeleteAutomation={handleDeleteAutomation}
                selectedAutomationId={isAutomationsNavigation(navState) && navState.details ? navState.details.automationId : null}
                workspaceRootPath={activeWorkspace?.rootPath}
              />
            )}
            {isSettingsNavigation(navState) && (
              /* Settings Navigator */
              <SettingsNavigator
                selectedSubpage={navState.subpage}
                onSelectSubpage={(subpage) => handleSettingsClick(subpage)}
              />
            )}
            {isSessionsNavigation(navState) && (
              /* Sessions List */
              <>
                {/* SessionList: Scrollable list of session cards */}
                {/* Key on sidebarMode forces full remount when switching views, skipping animations */}
                <SessionList
                  key={sessionFilter?.kind}
                  items={searchActive ? workspaceSessionMetas : filteredSessionMetas}
                  onDelete={handleDeleteSession}
                  onFlag={onFlagSession}
                  onUnflag={onUnflagSession}
                  onArchive={onArchiveSession}
                  onUnarchive={onUnarchiveSession}
                  onMarkUnread={onMarkSessionUnread}
                  onSessionStatusChange={onSessionStatusChange}
                  onRename={onRenameSession}
                  onFocusChatInput={(targetSessionId) => {
                    focusChatInputForSession(targetSessionId ?? focusedSessionId ?? session.selected)
                  }}
                  onSessionSelect={(selectedMeta) => {
                    navigateToSession(selectedMeta.id)
                  }}
                  onOpenInNewWindow={(selectedMeta) => {
                    if (activeWorkspaceId) {
                      window.electronAPI.openSessionInNewWindow(activeWorkspaceId, selectedMeta.id)
                    }
                  }}
                  onNavigateToView={(view) => {
                    if (view === 'allSessions') {
                      navigate(routes.view.allSessions())
                    } else if (view === 'flagged') {
                      navigate(routes.view.flagged())
                    }
                  }}
                  sessionOptions={sessionOptions}
                  searchActive={searchActive}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSearchClose={() => {
                    setSearchActive(false)
                    setSearchQuery('')
                  }}
                  sessionStatuses={effectiveSessionStatuses}
                  evaluateViews={evaluateViews}
                  labels={displayLabelConfigs}
                  onLabelsChange={handleSessionLabelsChange}
                  groupingMode={chatGroupingMode}
                  workspaceId={activeWorkspaceId ?? undefined}
                  statusFilter={listFilter}
                  labelFilterMap={labelFilter}
                  focusedSessionId={panelCount === 0 ? null : panelCount > 1 ? focusedSessionId : undefined}
                  onNavigateToSession={panelCount > 1 ? navigateToSessionInPanel : undefined}
                  hasPendingPrompt={hasPendingPrompt}
                  activeChatMatchInfo={chatMatchInfo}
                />
              </>
            )}
              </>
            )}
            </div>
          }
          navigatorWidth={isAutoCompact ? navigatorPanelWidth : (effectiveSidebarAndNavigatorHidden ? 0 : navigatorPanelWidth)}
          navigatorResizeSash={!effectiveSidebarAndNavigatorHidden ? (
            <div
              ref={sessionListHandleRef}
              data-panel-role="navigator-resize-sash"
              role="separator"
              aria-orientation="vertical"
              aria-label={isNovelWorkspaceNavigatorActive ? t('writing.workspace') : t('sidebar.allSessions')}
              onMouseDown={(e) => { beginResize(isNovelWorkspaceNavigatorActive ? 'novel-workspace-navigator' : 'session-list', e) }}
              onMouseMove={(e) => {
                if (sessionListHandleRef.current) {
                  const rect = sessionListHandleRef.current.getBoundingClientRect()
                  setSessionListHandleY(e.clientY - rect.top)
                }
              }}
              onMouseLeave={() => {
                if (isResizing !== 'session-list' && isResizing !== 'novel-workspace-navigator') {
                  setSessionListHandleY(null)
                }
              }}
              className="relative h-full cursor-col-resize flex justify-center shrink-0 z-dropdown"
              style={{
                width: 0,
                margin: `0 ${NAVIGATOR_SASH_FLEX_MARGIN}px`,
              }}
            >
              <div
                className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 flex justify-center cursor-col-resize"
                style={{ width: NAVIGATOR_SASH_HIT_WIDTH }}
              >
                <div
                  className="absolute left-1/2 -translate-x-1/2"
                  style={{
                    ...getResizeGradientStyle(sessionListHandleY, sessionListHandleRef.current?.clientHeight ?? null),
                    width: PANEL_SASH_LINE_WIDTH,
                    top: PANEL_STACK_VERTICAL_OVERFLOW,
                    bottom: PANEL_STACK_VERTICAL_OVERFLOW,
                  }}
                />
              </div>
            </div>
          ) : null}
          isSidebarAndNavigatorHidden={effectiveSidebarAndNavigatorHidden}
          isRightSidebarVisible={false}
          isCompact={isAutoCompact}
          isResizing={!!isResizing}
          hidePanelCloseButton={hasPrimarySidebar}
        />

        {/* Sidebar Resize Handle (absolute, hidden in focused mode) */}
        {!effectiveSidebarAndNavigatorHidden && hasPrimarySidebar && (
        <div
          ref={resizeHandleRef}
          role="separator"
          aria-orientation="vertical"
          onMouseDown={(e) => { beginResize('sidebar', e) }}
          onMouseMove={(e) => {
            if (resizeHandleRef.current) {
              const rect = resizeHandleRef.current.getBoundingClientRect()
              setSidebarHandleY(e.clientY - rect.top)
            }
          }}
          onMouseLeave={() => { if (!isResizing) setSidebarHandleY(null) }}
          className="absolute cursor-col-resize z-dropdown flex justify-center"
          style={{
            width: PANEL_SASH_HIT_WIDTH,
            top: PANEL_STACK_VERTICAL_OVERFLOW,
            bottom: PANEL_STACK_VERTICAL_OVERFLOW,
            left: isSidebarVisible
              ? sidebarWidth + (PANEL_GAP / 2) - PANEL_SASH_HALF_HIT_WIDTH
              : -PANEL_GAP,
            transition: isResizing === 'sidebar' ? undefined : 'left 0.15s ease-out',
          }}
        >
          <div
            className="h-full"
            style={{
              ...getResizeGradientStyle(sidebarHandleY, resizeHandleRef.current?.clientHeight ?? null),
              width: PANEL_SASH_LINE_WIDTH,
            }}
          />
        </div>
        )}

      </div>

      {/* What's New overlay */}
      <DocumentFormattedMarkdownOverlay
        isOpen={showWhatsNew}
        onClose={() => setShowWhatsNew(false)}
        content={releaseNotesContent}
        onOpenUrl={(url) => window.electronAPI.openUrl(url)}
      />

      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        workspaceId={activeWorkspaceId ?? undefined}
        sessions={workspaceSessionMetas}
        novelFiles={novelWorkspaceFiles}
        formatNovelFileTitle={(file) => formatNovelWorkspaceFileTitle(file, t)}
        onOpenSession={navigateToSession}
        onOpenNovelFile={(file) => {
          void handleSelectNovelFile(file)
        }}
      />

      {/* Delete automation confirmation dialog */}
      <Dialog open={!!automationPendingDelete} onOpenChange={(open) => { if (!open) setAutomationPendingDelete(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("dialog.deleteAutomation.title")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="dialog.deleteAutomation.description"
                values={{ name: pendingDeleteAutomation?.name }}
                components={{ strong: <strong /> }}
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutomationPendingDelete(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={confirmDeleteAutomation}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send to Workspace dialog (driven by sendToWorkspaceAtom) */}
      <SendToWorkspaceDialog
        open={sendToWorkspaceIds.length > 0}
        onOpenChange={(open) => { if (!open) setSendToWorkspaceIds([]) }}
        sessionIds={sendToWorkspaceIds}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onTransferComplete={handleTransferComplete}
      />

      <NovelExportDialog
        open={novelExportDialogOpen}
        files={novelWorkspaceFiles}
        exporting={novelExporting}
        onOpenChange={(open) => {
          if (!novelExporting) setNovelExportDialogOpen(open)
        }}
        onExport={handleExportNovelWorkspace}
      />

      <NovelVersionHistoryDialog
        open={novelVersionDialogOpen}
        versions={novelVersions}
        loading={novelVersionsLoading}
        saving={novelVersionSaving}
        restoringHash={novelVersionRestoringHash}
        onOpenChange={setNovelVersionDialogOpen}
        onCreateVersion={handleCreateNovelVersion}
        onRefresh={refreshNovelVersions}
        onRestore={handleRestoreNovelVersion}
      />

      <Dialog open={!!novelCreateFileTarget} onOpenChange={(open) => {
        if (!open && !novelCreatingFile) {
          setNovelCreateFileTarget(null)
          setNovelCreateFileValue('')
        }
      }}>
        <DialogContent className="sm:max-w-[420px]" showCloseButton={!novelCreatingFile}>
          <DialogHeader>
            <DialogTitle>{novelCreateFileTarget?.title}</DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <Input
              value={novelCreateFileValue}
              onChange={(event) => setNovelCreateFileValue(event.target.value)}
              placeholder={novelCreateFileTarget?.placeholder}
              disabled={novelCreatingFile}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSubmitNovelCreateFile()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={novelCreatingFile}
              onClick={() => {
                setNovelCreateFileTarget(null)
                setNovelCreateFileValue('')
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={novelCreatingFile || !novelCreateFileValue.trim()}
              onClick={() => void handleSubmitNovelCreateFile()}
            >
              {t('common.create', '创建')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Messaging dialogs (pairing-code + WA connect) — driven by messagingDialogAtom.
          Mounted here so they survive context-menu / dropdown close. */}
      <MessagingDialogHost />

    </AppShellProvider>
  )
}
