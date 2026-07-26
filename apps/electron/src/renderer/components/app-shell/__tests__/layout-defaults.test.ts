// input: app shell viewport width requirements
// output: regression coverage for default shell column sizing
// pos: protects the default three-column app shell layout contract

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

import * as layoutDefaults from '../layout-defaults'
import {
  DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO,
  getNavigatorResizeMaxWidth,
  getDefaultWritingWorkspaceLayoutWidths,
  isUserConfiguredShellLayoutWidth,
  resolveInitialShellLayoutWidths,
  shouldResolveInitialShellLayoutWidths,
} from '../layout-defaults'
import {
  PANEL_EDGE_INSET,
  PANEL_GAP,
  PANEL_SASH_LINE_WIDTH,
} from '../panel-constants'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const panelConstantsSource = readFileSync(new URL('../panel-constants.ts', import.meta.url), 'utf8')
const panelStackSource = readFileSync(new URL('../PanelStackContainer.tsx', import.meta.url), 'utf8')
const panelSlotSource = readFileSync(new URL('../PanelSlot.tsx', import.meta.url), 'utf8')
const panelHeaderSource = readFileSync(new URL('../PanelHeader.tsx', import.meta.url), 'utf8')
const resizableColumnSource = readFileSync(new URL('../ResizableColumn.tsx', import.meta.url), 'utf8')
const resizeGradientSource = readFileSync(new URL('../../../hooks/useResizeGradient.ts', import.meta.url), 'utf8')
const rendererCssSource = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8')
const editorPanelSource = readFileSync(
  new URL('../../writing/NovelDocumentEditorPanel.tsx', import.meta.url),
  'utf8',
)
const workspaceEmptyStateSource = readFileSync(
  new URL('../../workspace/WorkspaceEmptyState.tsx', import.meta.url),
  'utf8',
)
const localStorageSource = readFileSync(new URL('../../../lib/local-storage.ts', import.meta.url), 'utf8')

describe('app shell layout defaults', () => {
  it('uses a 2:5:3 default ratio for catalog, document, and dialog columns', () => {
    expect(DEFAULT_WRITING_WORKSPACE_LAYOUT_RATIO).toEqual({
      catalog: 2,
      document: 5,
      dialog: 3,
    })

    expect(getDefaultWritingWorkspaceLayoutWidths(1000)).toEqual({
      catalog: 200,
      document: 500,
      dialog: 300,
    })

    expect(Object.prototype.hasOwnProperty.call(layoutDefaults, 'DEFAULT_SHELL_LAYOUT_RATIO')).toBe(false)
  })

  it('derives first-run writing workspace width from catalog/document/dialog space', () => {
    const widths = resolveInitialShellLayoutWidths({
      totalWidth: 2000,
      edgeInset: 6,
      panelGap: 6,
      sidebarPersisted: false,
      workspacePersisted: false,
    })

    expect(widths.sidebar).toBe(396)
    expect(widths.workspace).toBe(991)
    expect(widths.assistant).toBe(595)
  })

  it('excludes the activity rail from the catalog/document/dialog ratio denominator', () => {
    const widths = resolveInitialShellLayoutWidths({
      totalWidth: 2000,
      activityRailWidth: 48,
      edgeInset: 6,
      panelGap: 6,
      sidebarPersisted: false,
      workspacePersisted: false,
    })

    expect(widths.sidebar).toBe(387)
    expect(widths.workspace).toBe(967)
    expect(widths.assistant).toBe(580)
  })

  it('keeps persisted user widths instead of overriding them with the ratio', () => {
    const widths = resolveInitialShellLayoutWidths({
      totalWidth: 2000,
      edgeInset: 6,
      panelGap: 6,
      sidebarPersisted: true,
      workspacePersisted: true,
      currentSidebarWidth: 240,
      currentWorkspaceWidth: 720,
    })

    expect(widths.sidebar).toBe(240)
    expect(widths.workspace).toBe(720)
    expect(widths.assistant).toBe(1022)
  })

  it('clamps an oversized persisted writing workspace so the assistant keeps its desktop minimum', () => {
    const widths = resolveInitialShellLayoutWidths({
      totalWidth: 2000,
      edgeInset: 6,
      panelGap: 6,
      assistantMinWidth: 440,
      sidebarPersisted: true,
      workspacePersisted: true,
      currentSidebarWidth: 300,
      currentWorkspaceWidth: 1600,
    })

    expect(widths.sidebar).toBe(300)
    expect(widths.workspace).toBe(1242)
    expect(widths.assistant).toBe(440)
  })

  it('does not treat legacy default widths as user-configured layout choices', () => {
    expect(isUserConfiguredShellLayoutWidth('sidebar', 220, true)).toBe(false)
    expect(isUserConfiguredShellLayoutWidth('workspace', 560, true)).toBe(false)
    expect(isUserConfiguredShellLayoutWidth('workspace', 860, true)).toBe(false)

    expect(isUserConfiguredShellLayoutWidth('sidebar', 248, true)).toBe(true)
    expect(isUserConfiguredShellLayoutWidth('workspace', 720, true)).toBe(true)
    expect(isUserConfiguredShellLayoutWidth('workspace', 560, false)).toBe(false)
  })

  it('splits the remaining width as 5:3 when only the sidebar width is persisted', () => {
    const widths = resolveInitialShellLayoutWidths({
      totalWidth: 2000,
      edgeInset: 6,
      panelGap: 6,
      sidebarPersisted: true,
      workspacePersisted: false,
      currentSidebarWidth: 220,
    })

    expect(widths.sidebar).toBe(220)
    expect(widths.workspace).toBe(1101)
    expect(widths.assistant).toBe(661)
  })

  it('allows the writing workspace to grow until the assistant reaches its minimum width', () => {
    expect(getNavigatorResizeMaxWidth({
      shellWidth: 2000,
      navigatorStartX: 230,
      edgeInset: 6,
      panelGap: 6,
      assistantMinWidth: 440,
    })).toBe(1318)
  })

  it('keeps the assistant panel at its minimum width when resolving first-run desktop proportions', () => {
    const widths = resolveInitialShellLayoutWidths({
      totalWidth: 1400,
      edgeInset: 6,
      panelGap: 6,
      sidebarPersisted: false,
      workspacePersisted: false,
      assistantMinWidth: 440,
    })

    expect(widths.sidebar).toBe(276)
    expect(widths.workspace).toBe(666)
    expect(widths.assistant).toBe(440)
  })

  it('defers first-run desktop proportions while the shell is still compact', () => {
    expect(shouldResolveInitialShellLayoutWidths(0, 768)).toBe(false)
    expect(shouldResolveInitialShellLayoutWidths(767, 768)).toBe(false)
    expect(shouldResolveInitialShellLayoutWidths(768, 768)).toBe(true)
  })

  it('keeps the manuscript column independent of the active route', () => {
    // The manuscript and the conversation list are distinct roles. Gating the
    // document on the writing route made opening a new conversation replace the
    // manuscript with the conversation list.
    expect(appShellSource).toContain('const showWritingDocumentSurface = showWritingWorkspaceShell')
    expect(appShellSource).not.toContain('const showWritingDocumentSurface = isProjectRuntime && isWritingNavigation(navState)')
    // The navigator column carries one role, so its width no longer switches meaning.
    expect(appShellSource).toContain('const navigatorPanelWidth = sessionListWidth')
  })

  it('leaves the manuscript width to the user when the window resizes', () => {
    // The dock is anchored to the right edge, so a wider window must widen the
    // conversation, not the manuscript. Only the clamp may move it.
    expect(appShellSource).toContain('shouldResolveInitialShellLayoutWidths(shellWidth, MOBILE_THRESHOLD)')
    expect(appShellSource).toContain('DEFAULT_DOCUMENT_DOCK_WIDTH_RATIO')
    expect(appShellSource).not.toContain('preserveAssistantWidthOnShellResize')
    expect(appShellSource).not.toContain('preservingNovelWorkspaceAssistant')
  })

  it('resizes both right-side columns by one shared handle-delta rule', () => {
    // The directory owns the right edge; the manuscript is now a middle column.
    // Neither can measure from a wall, so both share the position-independent
    // delta rule (width = dragStartWidth + handleDelta) in a single branch.
    expect(appShellSource).toContain("if (mode === 'directory-dock' || mode === 'document-dock')")
    expect(appShellSource).toContain('resizeStartXRef.current - clientX')
  })

  it('bounds the directory column by its own min width as the outermost navigator', () => {
    expect(appShellSource).toContain("if (mode === 'directory-dock')")
    expect(appShellSource).toContain('WORKSPACE_DIRECTORY_MIN_WIDTH')
  })

  it('keeps the writing columns on one panel chrome contract', () => {
    expect(appShellSource).toContain('paddingBottom: PANEL_EDGE_INSET, gap: PANEL_GAP')
    expect(resizableColumnSource).toContain('useResizeGradient')
    expect(resizableColumnSource).not.toContain('bg-border/60')
    expect(resizableColumnSource).not.toContain('marginBottom: PANEL_EDGE_INSET')
    expect(resizableColumnSource).not.toContain('borderRadius')
    expect(appShellSource).not.toContain('isRightSidebarVisible')
    expect(appShellSource).not.toContain('isAtRightEdge')
    expect(editorPanelSource).toContain('h-[42px]')
    expect(workspaceEmptyStateSource).toContain('h-[42px]')
    expect(panelHeaderSource).toContain('h-[42px]')
  })

  it('renders structural panes as one continuous workbench with parent-owned seams', () => {
    expect(PANEL_GAP).toBe(0)
    expect(PANEL_EDGE_INSET).toBe(0)
    expect(PANEL_SASH_LINE_WIDTH).toBe(1)
    expect(panelConstantsSource).not.toContain('RADIUS_')
    expect(panelConstantsSource).not.toContain('PANEL_STACK_VERTICAL_OVERFLOW')
    expect(panelConstantsSource).not.toContain('PANEL_SASH_FLEX_MARGIN')
    expect(panelStackSource).not.toContain('shadow-middle')
    expect(panelStackSource).not.toContain('borderRadius')
    expect(panelSlotSource).not.toContain('shadow-middle')
    expect(panelSlotSource).not.toContain('shadow-panel-focused')
    expect(panelSlotSource).not.toContain('borderRadius')
    expect(resizableColumnSource).not.toContain('shadow-middle')
    expect(resizeGradientSource).toContain('var(--foreground) 9%')
    expect(panelHeaderSource).toContain('border-b border-foreground/[0.09]')
    expect(rendererCssSource).toContain('[data-panel-role="navigator"]')
    expect(rendererCssSource).toContain('[data-panel-role="content"]')
    expect(rendererCssSource).toContain('[data-panel-role="document"]')
    expect(rendererCssSource).toContain('[data-panel-role="directory"]')
  })

  it('folds the directory independently and slides right-side columns in and out', () => {
    expect(localStorageSource).toContain("writingWorkspaceVisible: 'writing-workspace-visible'")
    expect(localStorageSource).toContain("workspaceDirectoryVisible: 'workspace-directory-visible'")
    expect(appShellSource).toContain('const [workspaceDirectoryVisible, setWorkspaceDirectoryVisible]')
    expect(appShellSource).toContain('activityWorkspaceDirectory && rightWorkspaceVisible && workspaceDirectoryVisible')
    expect(appShellSource).toContain("t('writing.directory.collapse', '收起目录')")
    expect(appShellSource).toContain("t('writing.directory.expand', '展开目录')")
    expect(appShellSource).toContain('<AnimatePresence initial={false}>')
    expect(resizableColumnSource).toContain('useReducedMotion')
    expect(resizableColumnSource).toContain('initial={{ width: 0, x: PANEL_SLIDE_OFFSET, opacity: 0 }}')
    expect(resizableColumnSource).toContain('exit={{ width: 0, x: PANEL_SLIDE_OFFSET, opacity: 0 }}')
    expect(resizableColumnSource).toContain('disableAnimation')
  })

  it('keeps the shared desktop panel minimum as the default while writing can reserve less space', () => {
    expect(panelSlotSource).toContain('minWidth = PANEL_MIN_WIDTH')
    expect(panelSlotSource).toContain('? { flexGrow: 1, minWidth: isCompact ? 0 : minWidth }')
    expect(panelSlotSource).toContain(': { flexGrow: proportion, flexShrink: 1, flexBasis: 0, minWidth }')
    expect(appShellSource).toContain('const WRITING_ASSISTANT_MIN_WIDTH = 320')
    expect(appShellSource).toContain('contentPanelMinWidth={showWritingDocumentColumn ? WRITING_ASSISTANT_MIN_WIDTH : PANEL_MIN_WIDTH}')
    expect(panelStackSource).toContain('minWidth={contentPanelMinWidth}')
  })

  it('uses shared default layout constants for both navigator widths before measurement', () => {
    expect(appShellSource).toContain('storage.get(storage.KEYS.sessionListWidth, DEFAULT_WORKSPACE_WIDTH)')
    expect(appShellSource).toContain('const NOVEL_WORKSPACE_NAVIGATOR_DEFAULT_WIDTH = DEFAULT_WORKSPACE_WIDTH')
  })
})
