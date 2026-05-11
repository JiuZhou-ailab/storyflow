// input: Novel workspace file projections and renderer callbacks
// output: Regression coverage for the Cursor-style writing workspace layout
// pos: Keeps writing catalog navigation in the app shell and document editing in the navigator column

import * as React from 'react'
import { readFileSync } from 'fs'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import { initReactI18next } from 'react-i18next'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

setupI18n([initReactI18next])

let NovelDocumentEditorPanel: typeof import('../NovelDocumentEditorPanel').NovelDocumentEditorPanel
let NovelSectionList: typeof import('../NovelSectionList').NovelSectionList

beforeAll(async () => {
  const editorModule = await import('../NovelDocumentEditorPanel')
  const listModule = await import('../NovelSectionList')
  NovelDocumentEditorPanel = editorModule.NovelDocumentEditorPanel
  NovelSectionList = listModule.NovelSectionList
})

describe('novel writing workspace layout', () => {
  it('renders the selected Markdown document in a single editable writing surface', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' }}
        content={'# 第一章\n\n你好 world'}
        loading={false}
        saving={false}
        onChange={() => {}}
      />
    )

    expect(html).toContain('tiptap-editor--with-toolbar')
    expect(html).toContain('tiptap-editor--manuscript')
    expect(html).toContain('tiptap-editor--line-numbers')
    expect(html).toContain('Total 10 characters')
    expect(html).not.toContain('story/chapters/chapter-01.md')
    expect(html).not.toContain('Save')
    expect(html).not.toContain('Open')
    expect(html).not.toContain('Write')
    expect(html).not.toContain('Preview')
    expect(html).not.toContain('Source')
  })

  it('renders writer-facing file labels in the writing catalog', () => {
    const html = renderToStaticMarkup(
      <NovelSectionList
        files={[
          { path: '/novel/bible/structure.md', relativePath: 'bible/structure.md' },
          { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
        ]}
        onSelectFile={() => {}}
      />
    )

    expect(html).toContain('Narrative structure')
    expect(html).toContain('Chapter 1')
    expect(html).toContain('title="bible/structure.md"')
    expect(html).not.toContain('>bible/structure.md<')
  })

  it('uses the mature TipTap Markdown editor as the only document editing mode', () => {
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const tiptapEditorSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx', import.meta.url), 'utf-8')
    const tiptapBubbleSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/markdown/TiptapBubbleMenus.tsx', import.meta.url), 'utf-8')
    const tiptapEditorStyles = readFileSync(new URL('../../../../../../../packages/ui/src/components/markdown/tiptap-editor.css', import.meta.url), 'utf-8')

    expect(editorPanelSource).toContain('TiptapMarkdownEditor')
    expect(editorPanelSource).toContain('showToolbar')
    expect(editorPanelSource).toContain('surface="manuscript"')
    expect(editorPanelSource).toContain("markdownEngine=\"official\"")
    expect(editorPanelSource).not.toContain('DocumentViewMode')
    expect(editorPanelSource).not.toContain('ShikiCodeEditor')
    expect(editorPanelSource).not.toContain('common.preview')
    expect(editorPanelSource).not.toContain('common.source')
    expect(tiptapEditorSource).toContain('showToolbar?: boolean')
    expect(tiptapEditorSource).toContain("surface?: 'default' | 'manuscript'")
    expect(tiptapEditorSource).toContain('showLineNumbers?: boolean')
    expect(tiptapEditorSource).toContain('bottomRightAccessory?: React.ReactNode')
    expect(tiptapEditorSource).toContain('tiptap-editor-status-badge')
    expect(tiptapEditorSource).toContain('TiptapFixedToolbar')
    expect(tiptapEditorSource).toContain('onAskAiForSelection?: (request: TiptapSelectionAiRequest) => Promise<string>')
    expect(tiptapBubbleSource).toContain('onAskAiForSelection')
    expect(tiptapBubbleSource).toContain('SelectionAiPrompt')
    expect(tiptapBubbleSource).toContain("placement: 'bottom-start'")
    expect(tiptapBubbleSource).toContain("t('editor.askAiPlaceholder'")
    expect(tiptapBubbleSource).toContain('submitSelectionPrompt')
    expect(tiptapBubbleSource).toContain('inputRef.current?.focus()')
    expect(tiptapBubbleSource).toContain('event.preventDefault()')
    expect(tiptapBubbleSource).not.toContain("title={t('editor.askAi', 'Ask AI')}")
    expect(tiptapBubbleSource).not.toContain('Sparkles')
    expect(tiptapEditorStyles).toContain('.tiptap-editor--manuscript .tiptap-prose')
    expect(tiptapEditorStyles).toContain('--tiptap-manuscript-width')
    expect(tiptapEditorStyles).toContain('.tiptap-editor--line-numbers .tiptap-prose')
    expect(tiptapEditorStyles).toContain('.tiptap-editor-status-badge')
  })

  it('rewrites selected novel text in place without routing through the chat stream', () => {
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf-8')
    const sessionManagerSource = readFileSync(new URL('../../../../../../../packages/server-core/src/sessions/SessionManager.ts', import.meta.url), 'utf-8')
    const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf-8')
    const tiptapBubbleSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/markdown/TiptapBubbleMenus.tsx', import.meta.url), 'utf-8')

    expect(editorPanelSource).toContain('onAskAiForSelection')
    expect(appShellSource).toContain('handleAskAiForNovelSelection')
    expect(appShellSource).toContain('selectedNovelFile.path')
    expect(appShellSource).toContain('window.electronAPI.rewriteNovelSelection')
    expect(tiptapBubbleSource).toContain('insertContentAt({ from: selectionRange.from, to: selectionRange.to }, replacement')
    expect(tiptapBubbleSource).toContain("contentType: 'markdown'")
    expect(appShellSource).not.toContain('buildNovelSelectionChatMessage')
    expect(appShellSource).not.toContain('buildNovelSelectionOneTimeContext')
    expect(appShellSource).not.toContain('onSendMessage(effectiveSessionId')
    expect(appShellSource).not.toContain('oneTimeContext')
    expect(appSource).toContain('const hideUserMessage = sendOptions?.hideUserMessage === true')
    expect(appSource).toContain('if (!hideUserMessage)')
    expect(sessionManagerSource).toContain('async queryOnce')
    expect(sessionManagerSource).toContain('async rewriteNovelSelection')
    expect(appShellSource).not.toContain('focusChatInputForSession(effectiveSessionId)')
    expect(appShellSource).not.toContain("new CustomEvent('craft:set-input'")
    expect(chatPageSource).not.toContain("window.addEventListener('craft:set-input'")
  })

  it('indexes writing workspace files for chat mentions by display title while preserving paths', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf-8')
    const chatDisplaySource = readFileSync(new URL('../../app-shell/ChatDisplay.tsx', import.meta.url), 'utf-8')
    const inputSource = readFileSync(new URL('../../app-shell/input/FreeFormInput.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('const mentionFiles = React.useMemo')
    expect(appShellSource).toContain('formatNovelWorkspaceFileTitle(file, t)')
    expect(appShellSource).toContain('relativePath: file.relativePath')
    expect(chatPageSource).toContain('mentionFiles={mentionFiles}')
    expect(chatDisplaySource).toContain('mentionFiles,')
    expect(inputSource).toContain('files: mentionFiles')
  })

  it('keeps conversation history as a collapsible tab in the chat header', () => {
    const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf-8')
    const historyMenuSource = chatPageSource.slice(
      chatPageSource.indexOf('function ConversationHistoryMenu'),
      chatPageSource.indexOf('const ChatPage')
    )

    expect(chatPageSource).toContain('ConversationHistoryMenu')
    expect(chatPageSource).toContain("t('chat.history')")
    expect(chatPageSource).toContain('workspaceSessionMetas')
    expect(chatPageSource).toContain('routes.view.allSessions(item.id)')
    expect(historyMenuSource).toContain('<PanelHeaderCenterButton')
    expect(historyMenuSource).toContain("title={t('chat.history')}")
    expect(chatPageSource).toContain("title={t('chat.session')} leadingAction={headerLeadingAction} actions={headerActions}")
  })

  it('keeps writing catalog ownership in the left shell and document editing in the navigator shell', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('NovelDocumentEditorPanel')
    expect(appShellSource).toContain('novelWorkspaceSidebarLinks')
    expect(appShellSource).not.toContain('<NovelWorkspaceNavigatorPanel')
    expect(chatPageSource).not.toContain('NovelWorkspacePanel')
    expect(chatPageSource).not.toContain('NovelWorkspaceNavigatorPanel')
    expect(chatPageSource).not.toContain('NovelDocumentEditorPanel')
    expect(chatPageSource).not.toContain('WritingChatDropdown')
  })

  it('moves global workspace tools into the workspace header top bar', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const topBarSource = readFileSync(new URL('../../app-shell/TopBar.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('novelWorkspaceUtilitySidebarLinks')
    expect(appShellSource).toContain('workspaceTools={showNovelWorkspaceSidebar ? (')
    expect(topBarSource).toContain('workspaceTools?: React.ReactNode')
    expect(topBarSource).toContain('{workspaceTools ? (')
    expect(appShellSource).toContain('nav:sources')
    expect(appShellSource).toContain('nav:skills')
    expect(appShellSource).toContain('nav:settings')
    expect(appShellSource).toContain('links={showNovelWorkspaceSidebar ? novelWorkspaceSidebarLinks : [')
    expect(appShellSource).not.toContain('[...novelWorkspaceUtilitySidebarLinks, ...novelWorkspaceSidebarLinks]')
  })

  it('exposes every selectable writing file section in the left catalog', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain("{ id: 'style'")
    expect(appShellSource).toContain('files: novelWorkspaceTree.style.files')
    expect(appShellSource).toContain("{ id: 'analysis'")
    expect(appShellSource).toContain('files: novelWorkspaceTree.analysis.files')
    expect(appShellSource).toContain("{ id: 'work'")
    expect(appShellSource).toContain('files: novelWorkspaceTree.work.files')
  })

  it('exposes selectable writing workspace export controls', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const exportDialogSource = readFileSync(new URL('../NovelExportDialog.tsx', import.meta.url), 'utf-8')
    const topBarSource = readFileSync(new URL('../../app-shell/TopBar.tsx', import.meta.url), 'utf-8')
    const zhHansLocale = JSON.parse(readFileSync(new URL('../../../../../../../packages/shared/src/i18n/locales/zh-Hans.json', import.meta.url), 'utf-8'))
    const topBarRightSlotSource = topBarSource.slice(
      topBarSource.indexOf('{rightTools ? ('),
      topBarSource.indexOf('{/* Help button */')
    )

    expect(appShellSource).toContain('NovelExportDialog')
    expect(appShellSource).toContain('handleExportNovelWorkspace')
    expect(appShellSource).toContain('setNovelExportDialogOpen(true)')
    expect(appShellSource).toContain('rightTools={showNovelWorkspaceSidebar ? (')
    expect(appShellSource).toContain('buildNovelExportPlan')
    expect(appShellSource).toContain('buildMergedManuscriptContent')
    expect(appShellSource.indexOf('await window.electronAPI.createDirectory(exportRootPath)')).toBeLessThan(
      appShellSource.indexOf('await window.electronAPI.writeFile(targetPath')
    )
    expect(topBarSource).toContain('rightTools?: React.ReactNode')
    expect(topBarRightSlotSource).toContain('{rightTools ? (')
    expect(topBarRightSlotSource.indexOf('{rightTools ? (')).toBeLessThan(topBarRightSlotSource.indexOf('<DropdownMenu>'))
    expect(topBarSource).toContain('ml-auto flex min-w-0 flex-1 items-center justify-end gap-1')
    expect(exportDialogSource).toContain('NOVEL_EXPORT_SECTIONS')
    expect(exportDialogSource).toContain('mergeManuscript')
    expect(exportDialogSource).toContain("'writing.export.sections.manuscript'")
    expect(exportDialogSource).toContain("t('writing.export.title', '导出写作工作区')")
    expect(exportDialogSource).toContain("t('writing.export.action', '导出')")
    expect(exportDialogSource).toContain("manuscript: '正文'")
    expect(appShellSource).toContain("t('writing.export.action', '导出')")
    expect(zhHansLocale['writing.export.title']).toBe('导出写作工作区')
    expect(zhHansLocale['writing.export.sections.manuscript']).toBe('正文')
    expect(zhHansLocale['writing.export.mergeManuscript']).toBe('正文导出为一个文件')
  })

  it('auto-saves before file switching and selection Ask AI when the current document has unsaved edits', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const fileItemSource = appShellSource.slice(
      appShellSource.indexOf('const fileItem ='),
      appShellSource.indexOf('const sectionItems:')
    )
    const askAiSource = appShellSource.slice(
      appShellSource.indexOf('const handleAskAiForNovelSelection'),
      appShellSource.indexOf('const navigatorPanelWidth')
    )

    expect(appShellSource).toContain('handleSelectNovelFile')
    expect(appShellSource).toContain('ensureNovelDocumentSaved')
    expect(appShellSource).toContain('window.setTimeout')
    expect(appShellSource).toContain('window.clearTimeout')
    expect(fileItemSource).toContain('handleSelectNovelFile(file)')
    expect(fileItemSource).not.toContain('setSelectedNovelFilePath(file.path)')
    expect(askAiSource).toContain('const saved = await ensureNovelDocumentSaved()')
    expect(askAiSource).not.toContain('writing.askAiBlockedByUnsavedEdits')
    expect(askAiSource).toContain('window.electronAPI.rewriteNovelSelection')
    expect(askAiSource).not.toContain('onSendMessage(effectiveSessionId')
  })

  it('clears stale writing workspace state before probing a different root', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('novelWorkspaceRootRef')
    expect(appShellSource).toContain('nextCandidateRoots.has(currentNovelWorkspaceRoot)')
    expect(appShellSource).toContain('setNovelWorkspaceFiles([])')
  })

  it('hides the generic content panel close button in writing workspace mode', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const panelStackSource = readFileSync(new URL('../../app-shell/PanelStackContainer.tsx', import.meta.url), 'utf-8')
    const panelSlotSource = readFileSync(new URL('../../app-shell/PanelSlot.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('hidePanelCloseButton={showNovelWorkspaceSidebar}')
    expect(panelStackSource).toContain('hidePanelCloseButton?: boolean')
    expect(panelStackSource).toContain('hideCloseButton={hidePanelCloseButton}')
    expect(panelSlotSource).toContain('hideCloseButton?: boolean')
    expect(panelSlotSource).toContain('if (hideCloseButton) return undefined')
  })

  it('reviews novel file changes inline in the selected file instead of a detached overlay or sidebar item', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const multiDiffSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx', import.meta.url), 'utf-8')

    expect(editorPanelSource).toContain('NovelInlineReviewDiff')
    expect(editorPanelSource).toContain('reviewChange ? (')
    expect(editorPanelSource).toContain('ShikiDiffViewer')
    expect(editorPanelSource).toContain('UnifiedDiffViewer')
    expect(appShellSource).toContain('handleAcceptNovelChange')
    expect(appShellSource).toContain('handleRejectNovelChange')
    expect(appShellSource).toContain('buildRejectedFileContent')
    expect(appShellSource).toContain('handleAcceptAllNovelChanges')
    expect(appShellSource).toContain('void handleSelectNextNovelChangeAfterStatus')
    expect(appShellSource).not.toContain("id: 'writing:section:changes'")
    expect(appShellSource).not.toContain('handleOpenNovelChangeReview')
    expect(appShellSource).not.toContain('focusedChangeId: change.id')
    expect(appShellSource).not.toContain('onOpenReview=')
    expect(multiDiffSource).toContain('onAcceptChange?: (change: FileChange) => void')
    expect(multiDiffSource).toContain('onRejectChange?: (change: FileChange) => void')
  })

  it('normalizes agent file-change paths before matching them to selected writing files', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('normalizeNovelFileChangePaths(')
    expect(appShellSource).toContain('reviewableNovelFileChanges')
    expect(appShellSource).toContain('getPendingChangesForFile(reviewableNovelFileChanges')
  })

  it('keeps the novel catalog sidebar while opening workspace utility views', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('const showNovelWorkspaceSidebar = !!novelWorkspaceRoot')
    expect(appShellSource).toContain('const showNovelDocumentNavigator = isSessionsNavigation(navState) && showNovelWorkspaceSidebar')
    expect(appShellSource).toContain('if (!showNovelWorkspaceSidebar) return []')
    expect(appShellSource).toContain('if (showNovelWorkspaceSidebar) {')
    expect(appShellSource).toContain('NovelWorkspaceUtilityTopNav')
    expect(appShellSource).toContain('workspaceTools={showNovelWorkspaceSidebar ? (')
    expect(appShellSource).toContain('links={showNovelWorkspaceSidebar ? novelWorkspaceSidebarLinks : [')
    expect(appShellSource).toContain('{showNovelDocumentNavigator && novelWorkspaceRoot ? (')
    expect(appShellSource).toContain('handleAllSessionsClick()')
  })

  it('left-aligns sidebar item content instead of letting writing catalog labels drift toward the center', () => {
    const leftSidebarSource = readFileSync(new URL('../../app-shell/LeftSidebar.tsx', import.meta.url), 'utf-8')

    expect(leftSidebarSource).toContain('"group flex w-full items-center justify-start gap-2 rounded-[6px] text-left text-[13px] select-none outline-none"')
    expect(leftSidebarSource).toContain('<span className="min-w-0 flex-1 truncate text-left">{link.title}</span>')
  })

  it('does not position the navigator resize handle with detached left math', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('navigatorResizeSash=')
    expect(appShellSource).not.toContain('navigatorPanelWidth +')
    expect(appShellSource).not.toContain('sessionListWidth +\n              (PANEL_GAP / 2) -')
  })

  it('does not pin the novel workspace navigator to an unresizable fixed minimum', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).not.toContain('Math.max(sessionListWidth, 560)')
    expect(appShellSource).toContain('NOVEL_WORKSPACE_NAVIGATOR_MAX_WIDTH')
  })

  it('keeps novel navigator width separate from the regular session list width', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const localStorageSource = readFileSync(new URL('../../../lib/local-storage.ts', import.meta.url), 'utf-8')

    expect(localStorageSource).toContain('novelWorkspaceNavigatorWidth')
    expect(appShellSource).toContain('const [novelWorkspaceNavigatorWidth, setNovelWorkspaceNavigatorWidth]')
    expect(appShellSource).toContain('latestNovelWorkspaceNavigatorWidthRef')
    expect(appShellSource).toContain('setNovelWorkspaceNavigatorWidth(newWidth)')
    expect(appShellSource).toContain('storage.KEYS.novelWorkspaceNavigatorWidth')
    expect(appShellSource).toContain('const navigatorPanelWidth = showNovelDocumentNavigator')
    expect(appShellSource).toContain('? novelWorkspaceNavigatorWidth')
    expect(appShellSource).toContain(': sessionListWidth')
  })

  it('starts navigator resizing synchronously from the separator handle', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('beginResize')
    expect(appShellSource).toContain("beginResize(showNovelDocumentNavigator ? 'novel-workspace-navigator' : 'session-list', e)")
    expect(appShellSource).toContain("document.addEventListener('mousemove', handleMouseMove, true)")
    expect(appShellSource).toContain('z-dropdown')
  })

  it('keeps the navigator resize hit area on the real panel boundary', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const panelStackSource = readFileSync(new URL('../../app-shell/PanelStackContainer.tsx', import.meta.url), 'utf-8')

    expect(panelStackSource).toContain('navigatorResizeSash?: React.ReactNode')
    expect(panelStackSource).toContain('{hasNavigator ? navigatorResizeSash : null}')
    expect(appShellSource).toContain('navigatorResizeSash=')
    expect(appShellSource).toContain('navigatorPanelRef.current?.getBoundingClientRect().left')
    expect(appShellSource).toContain('data-panel-role="navigator-resize-sash"')
    expect(appShellSource).toContain('width: NAVIGATOR_SASH_HIT_WIDTH')
    expect(appShellSource).toContain('NAVIGATOR_SASH_FLEX_MARGIN')
    expect(appShellSource).not.toContain('relative w-0 h-full cursor-col-resize')
    expect(appShellSource).not.toContain('/* Navigator Resize Handle (absolute, hidden in focused mode) */')
  })

  it('starts navigator resizing from the shell capture zone around the boundary', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('NAVIGATOR_SASH_CAPTURE_HALF_WIDTH')
    expect(appShellSource).toContain('handleNavigatorResizeBoundaryMouseDownCapture')
    expect(appShellSource).toContain('onMouseDownCapture={handleNavigatorResizeBoundaryMouseDownCapture}')
    expect(appShellSource).toContain('navigatorPanelRect.right + (PANEL_GAP / 2)')
    expect(appShellSource).toContain("beginResize(showNovelDocumentNavigator ? 'novel-workspace-navigator' : 'session-list', e)")
  })
})
