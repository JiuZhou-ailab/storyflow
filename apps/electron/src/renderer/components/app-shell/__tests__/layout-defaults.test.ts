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

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const panelSlotSource = readFileSync(new URL('../PanelSlot.tsx', import.meta.url), 'utf8')

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

  it('resizes the manuscript from its left edge because it is right-anchored', () => {
    expect(appShellSource).toContain("if (mode === 'document-dock')")
    expect(appShellSource).toContain('available - clientX')
  })

  it('keeps the desktop assistant panel from shrinking below the shared panel minimum', () => {
    expect(panelSlotSource).toContain('? { flexGrow: 1, minWidth: isCompact ? 0 : PANEL_MIN_WIDTH }')
    expect(panelSlotSource).toContain(': { flexGrow: proportion, flexShrink: 1, flexBasis: 0, minWidth: PANEL_MIN_WIDTH }')
  })

  it('uses shared default layout constants for both navigator widths before measurement', () => {
    expect(appShellSource).toContain('storage.get(storage.KEYS.sessionListWidth, DEFAULT_WORKSPACE_WIDTH)')
    expect(appShellSource).toContain('const NOVEL_WORKSPACE_NAVIGATOR_DEFAULT_WIDTH = DEFAULT_WORKSPACE_WIDTH')
  })
})
