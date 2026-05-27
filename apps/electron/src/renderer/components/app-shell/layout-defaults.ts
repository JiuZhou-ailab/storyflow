// input: app shell viewport-independent layout ratio requirements
// output: default column widths for the desktop app shell
// pos: shared source of truth for first-run app shell column sizing

export const DEFAULT_SHELL_LAYOUT_RATIO = {
  sidebar: 2,
  workspace: 5,
  assistant: 3,
} as const

const DEFAULT_SHELL_LAYOUT_BASE_WIDTH = 1000
const LEGACY_DEFAULT_SIDEBAR_WIDTHS = new Set([220])
const LEGACY_DEFAULT_WORKSPACE_WIDTHS = new Set([500, 560, 860])

type ShellLayoutColumn = 'sidebar' | 'workspace'

export function getDefaultShellLayoutWidths(totalWidth = DEFAULT_SHELL_LAYOUT_BASE_WIDTH) {
  const totalRatio = DEFAULT_SHELL_LAYOUT_RATIO.sidebar
    + DEFAULT_SHELL_LAYOUT_RATIO.workspace
    + DEFAULT_SHELL_LAYOUT_RATIO.assistant
  const unit = totalWidth / totalRatio

  return {
    sidebar: Math.round(unit * DEFAULT_SHELL_LAYOUT_RATIO.sidebar),
    workspace: Math.round(unit * DEFAULT_SHELL_LAYOUT_RATIO.workspace),
    assistant: Math.round(unit * DEFAULT_SHELL_LAYOUT_RATIO.assistant),
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
  edgeInset,
  panelGap,
  assistantMinWidth = 0,
  sidebarPersisted,
  workspacePersisted,
  currentSidebarWidth,
  currentWorkspaceWidth,
}: ResolveInitialShellLayoutWidthsInput) {
  const availableWidth = Math.max(0, totalWidth - edgeInset - (panelGap * 2))
  const ratioWidths = getDefaultShellLayoutWidths(availableWidth)

  if (sidebarPersisted && !workspacePersisted) {
    const sidebar = currentSidebarWidth ?? ratioWidths.sidebar
    const remaining = Math.max(0, availableWidth - sidebar)
    const ratioWorkspace = Math.round(
      remaining * DEFAULT_SHELL_LAYOUT_RATIO.workspace
      / (DEFAULT_SHELL_LAYOUT_RATIO.workspace + DEFAULT_SHELL_LAYOUT_RATIO.assistant)
    )
    const workspace = Math.min(ratioWorkspace, Math.max(0, remaining - assistantMinWidth))

    return {
      sidebar,
      workspace,
      assistant: Math.max(0, remaining - workspace),
    }
  }

  const sidebar = sidebarPersisted ? currentSidebarWidth ?? ratioWidths.sidebar : ratioWidths.sidebar
  const remaining = Math.max(0, availableWidth - sidebar)
  const workspace = workspacePersisted
    ? currentWorkspaceWidth ?? ratioWidths.workspace
    : Math.min(ratioWidths.workspace, Math.max(0, remaining - assistantMinWidth))

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
