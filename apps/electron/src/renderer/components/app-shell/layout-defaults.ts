// input: app shell viewport-independent catalog/document/dialog ratio requirements
// output: default column widths for the desktop writing workspace shell
// pos: shared source of truth for first-run catalog, manuscript, and chat sizing

export const DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO = {
  catalog: 2,
  document: 5,
  dialog: 3,
} as const

const DEFAULT_SHELL_LAYOUT_BASE_WIDTH = 1000
const LEGACY_DEFAULT_SIDEBAR_WIDTHS = new Set([220])
const LEGACY_DEFAULT_WORKSPACE_WIDTHS = new Set([500, 560, 860])

type ShellLayoutColumn = 'sidebar' | 'workspace'

export function getDefaultWritingWorkspaceLayoutWidths(totalWidth = DEFAULT_SHELL_LAYOUT_BASE_WIDTH) {
  const totalRatio = DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.catalog
    + DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.document
    + DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.dialog
  const unit = totalWidth / totalRatio

  return {
    catalog: Math.round(unit * DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.catalog),
    document: Math.round(unit * DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.document),
    dialog: Math.round(unit * DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.dialog),
  }
}

function getDefaultShellLayoutWidths(totalWidth = DEFAULT_SHELL_LAYOUT_BASE_WIDTH) {
  const widths = getDefaultWritingWorkspaceLayoutWidths(totalWidth)

  return {
    sidebar: widths.catalog,
    workspace: widths.document,
    assistant: widths.dialog,
  }
}

export function isUserConfiguredShellLayoutWidth(
  column: ShellLayoutColumn,
  width: number | undefined,
  hasPersistedValue: boolean,
): boolean {
  if (!hasPersistedValue || width === undefined) return false

  const legacyWidths = column === 'sidebar'
    ? LEGACY_DEFAULT_SIDEBAR_WIDTHS
    : LEGACY_DEFAULT_WORKSPACE_WIDTHS

  return !legacyWidths.has(Math.round(width))
}

export interface ResolveInitialShellLayoutWidthsInput {
  totalWidth: number
  activityRailWidth?: number
  edgeInset: number
  panelGap: number
  assistantMinWidth?: number
  sidebarPersisted: boolean
  workspacePersisted: boolean
  currentSidebarWidth?: number
  currentWorkspaceWidth?: number
}

export function shouldResolveInitialShellLayoutWidths(shellWidth: number, compactThreshold: number): boolean {
  return shellWidth >= compactThreshold
}

export function resolveInitialShellLayoutWidths({
  totalWidth,
  activityRailWidth = 0,
  edgeInset,
  panelGap,
  assistantMinWidth = 0,
  sidebarPersisted,
  workspacePersisted,
  currentSidebarWidth,
  currentWorkspaceWidth,
}: ResolveInitialShellLayoutWidthsInput) {
  const availableWidth = Math.max(0, totalWidth - activityRailWidth - edgeInset - (panelGap * 2))
  const ratioWidths = getDefaultShellLayoutWidths(availableWidth)

  const clampWorkspaceWidth = (width: number, remaining: number) => {
    return Math.min(width, Math.max(0, remaining - assistantMinWidth))
  }

  if (sidebarPersisted && !workspacePersisted) {
    const sidebar = currentSidebarWidth ?? ratioWidths.sidebar
    const remaining = Math.max(0, availableWidth - sidebar)
    const ratioWorkspace = Math.round(
      remaining * DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.document
      / (DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.document + DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO.dialog)
    )
    const workspace = clampWorkspaceWidth(ratioWorkspace, remaining)

    return {
      sidebar,
      workspace,
      assistant: Math.max(0, remaining - workspace),
    }
  }

  const sidebar = sidebarPersisted ? currentSidebarWidth ?? ratioWidths.sidebar : ratioWidths.sidebar
  const remaining = Math.max(0, availableWidth - sidebar)
  const workspace = workspacePersisted
    ? clampWorkspaceWidth(currentWorkspaceWidth ?? ratioWidths.workspace, remaining)
    : clampWorkspaceWidth(ratioWidths.workspace, remaining)

  return {
    sidebar,
    workspace,
    assistant: Math.max(0, remaining - workspace),
  }
}

export interface NavigatorResizeMaxWidthInput {
  shellWidth: number
  navigatorStartX: number
  edgeInset: number
  panelGap: number
  assistantMinWidth: number
}

export function getNavigatorResizeMaxWidth({
  shellWidth,
  navigatorStartX,
  edgeInset,
  panelGap,
  assistantMinWidth,
}: NavigatorResizeMaxWidthInput): number {
  return Math.max(0, shellWidth - navigatorStartX - edgeInset - panelGap - assistantMinWidth)
}

const DEFAULT_SHELL_LAYOUT_WIDTHS = getDefaultShellLayoutWidths()

export const DEFAULT_SIDEBAR_WIDTH = DEFAULT_SHELL_LAYOUT_WIDTHS.sidebar
export const DEFAULT_WORKSPACE_WIDTH = DEFAULT_SHELL_LAYOUT_WIDTHS.workspace
