// input: Novel workspace file projections, review changes, and renderer callbacks
// output: Regression coverage for the Cursor-style writing workspace layout and inline review UI
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

  it('renders review changes directly in the manuscript body at the changed text', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' }}
        content={'# 第一章\n\n她走进明亮的房间。\n\n尾声'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChange={{
          id: 'change-1',
          filePath: '/novel/story/chapters/chapter-01.md',
          toolType: 'Edit',
          original: '安静的房间',
          modified: '明亮的房间',
        }}
      />
    )

    expect(html).toContain('data-testid="novel-inline-review-document"')
    expect(html).toContain('data-testid="novel-inline-review-change"')
    expect(html).toContain('<del')
    expect(html).toContain('<ins')
    expect(html).toContain('novel-review-deleted')
    expect(html).toContain('安静的房间')
    expect(html).toContain('novel-review-inserted')
    expect(html).toContain('明亮的房间')
    expect(html).toContain('<p>她走进<del')
    expect(html).toContain('</ins>。</p>')
    expect(html.indexOf('她走进')).toBeLessThan(html.indexOf('安静的房间'))
    expect(html.indexOf('明亮的房间')).toBeLessThan(html.indexOf('尾声'))
    expect(html).not.toContain('py-3')
    expect(html).not.toContain('my-4')
    expect(html).not.toContain('novel-review-markdown')
    expect(html).not.toContain('tiptap-editor--with-toolbar')
  })

  it('renders unified-diff review changes in the manuscript body when the patch maps to current text', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' }}
        content={'# 第一章\n\n她走进明亮的房间。\n\n尾声'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChange={{
          id: 'change-1',
          filePath: '/novel/story/chapters/chapter-01.md',
          toolType: 'Edit',
          original: '',
          modified: '',
          unifiedDiff: [
            'diff --git a/story/chapters/chapter-01.md b/story/chapters/chapter-01.md',
            '--- a/story/chapters/chapter-01.md',
            '+++ b/story/chapters/chapter-01.md',
            '@@ -1 +1 @@',
            '-她走进安静的房间。',
            '+她走进明亮的房间。',
          ].join('\n'),
        }}
      />
    )

    expect(html).toContain('data-testid="novel-inline-review-document"')
    expect(html).toContain('她走进安静的房间。')
    expect(html).toContain('她走进明亮的房间。')
    expect(html.indexOf('她走进明亮的房间。')).toBeLessThan(html.indexOf('尾声'))
  })

  it('uses the formatted Markdown editor for multiline review changes', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/正文/01.md', relativePath: '正文/01.md' }}
        content={'# 第一章\n\n- 第一段\n- 第二段'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChange={{
          id: 'change-1',
          filePath: '/novel/正文/01.md',
          toolType: 'Edit',
          original: '',
          modified: '',
          unifiedDiff: [
            '--- a/正文/01.md',
            '+++ b/正文/01.md',
            '@@ -0,0 +1,4 @@',
            '+# 第一章',
            '+',
            '+- 第一段',
            '+- 第二段',
          ].join('\n'),
        }}
      />
    )

    expect(html).not.toContain('data-testid="novel-inline-review-document"')
    expect(html).toContain('tiptap-editor--with-toolbar')
    expect(html).toContain('tiptap-editor--manuscript')
  })

  it('falls back to the editable manuscript when a review change cannot be placed safely', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' }}
        content={'# 第一章\n\n她走进明亮的房间。'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChange={{
          id: 'change-1',
          filePath: '/novel/story/chapters/chapter-01.md',
          toolType: 'Edit',
          original: '安静的房间',
          modified: '重复的房间',
        }}
      />
    )

    expect(html).toContain('tiptap-editor--with-toolbar')
    expect(html).not.toContain('data-testid="novel-inline-review-document"')
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
    expect(appShellSource).toContain('relaunchApp')
    expect(appShellSource).not.toContain("type: 'rewriteNovelSelection'")
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

  it('splits the writing catalog into global information and manuscript groups', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const sidebarSource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceSidebarLinks'),
      appShellSource.indexOf('const novelWorkspaceUtilitySidebarLinks')
    )

    expect(sidebarSource).toContain("id: 'writing:group:global'")
    expect(sidebarSource).toContain("t('writing.catalog.globalInfo', '全局信息')")
    expect(sidebarSource).toContain("const manuscriptGroupId = 'writing:group:manuscript'")
    expect(sidebarSource).toContain('globalSectionDefinitions')
    expect(sidebarSource).toContain('manuscriptSection')
    expect(sidebarSource).not.toContain("sectionDefinitions.map((section)")
  })

  it('uses current novel project history instead of global release notes in novel utility navigation', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const novelUtilityLinksSource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceUtilitySidebarLinks'),
      appShellSource.indexOf('// Unified sidebar items')
    )
    const novelKeyboardItemsSource = appShellSource.slice(
      appShellSource.indexOf('if (showNovelWorkspaceSidebar) {'),
      appShellSource.indexOf('// 1. Sessions section')
    )

    expect(novelUtilityLinksSource).toContain('nav:writing-version')
    expect(novelUtilityLinksSource).toContain("t('writing.version.title', '版本管理')")
    expect(novelUtilityLinksSource).toContain('setNovelVersionDialogOpen(true)')
    expect(novelUtilityLinksSource).not.toContain('nav:whats-new')
    expect(novelUtilityLinksSource).not.toContain('handleWhatsNewClick')
    expect(novelKeyboardItemsSource).toContain("result.push({ id: 'nav:writing-version'")
    expect(novelKeyboardItemsSource).toContain('setNovelVersionDialogOpen(true)')
    expect(novelKeyboardItemsSource).not.toContain("result.push({ id: 'nav:whats-new'")
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
    const versionDialogSource = readFileSync(new URL('../NovelVersionHistoryDialog.tsx', import.meta.url), 'utf-8')
    const topBarSource = readFileSync(new URL('../../app-shell/TopBar.tsx', import.meta.url), 'utf-8')
    const zhHansLocale = JSON.parse(readFileSync(new URL('../../../../../../../packages/shared/src/i18n/locales/zh-Hans.json', import.meta.url), 'utf-8'))
    const topBarRightSlotSource = topBarSource.slice(
      topBarSource.indexOf('{rightTools ? ('),
      topBarSource.indexOf('{/* Help button */')
    )

    expect(appShellSource).toContain('NovelExportDialog')
    expect(appShellSource).toContain('NovelVersionHistoryDialog')
    expect(appShellSource).toContain('handleExportNovelWorkspace')
    expect(appShellSource).toContain('handleCreateNovelVersion')
    expect(appShellSource).toContain('handleRestoreNovelVersion')
    expect(appShellSource).toContain('setNovelExportDialogOpen(true)')
    expect(appShellSource).toContain('setNovelVersionDialogOpen(true)')
    expect(appShellSource).toContain('rightTools={showNovelWorkspaceSidebar ? (')
    expect(appShellSource).toContain('buildNovelExportPlan')
    expect(appShellSource).toContain('buildMergedManuscriptContent')
    expect(appShellSource).toContain('NOVEL_AUTO_VERSION_CHAR_THRESHOLD = 100')
    expect(appShellSource).toContain('NOVEL_AUTO_VERSION_INTERVAL_MS = 5 * 60 * 1000')
    expect(appShellSource).toContain('novelAutoVersionTimerRef')
    expect(appShellSource).toContain("window.electronAPI.createWorkspaceVersion(novelWorkspaceRoot, { reason: 'auto' })")
    expect(appShellSource).toContain('window.electronAPI.listWorkspaceVersions(novelWorkspaceRoot, 30)')
    expect(appShellSource).toContain('window.electronAPI.restoreWorkspaceVersion(novelWorkspaceRoot, commitHash)')
    expect(appShellSource.indexOf('await window.electronAPI.createDirectory(exportRootPath)')).toBeLessThan(
      appShellSource.indexOf('await window.electronAPI.writeFile(targetPath')
    )
    expect(topBarSource).toContain('rightTools?: React.ReactNode')
    expect(topBarRightSlotSource).toContain('{rightTools ? (')
    expect(topBarRightSlotSource.indexOf('{rightTools ? (')).toBeLessThan(topBarRightSlotSource.indexOf('<DropdownMenu>'))
    expect(topBarSource).toContain('ml-auto flex min-w-0 flex-1 items-center justify-end gap-1')
    expect(topBarSource).toContain('w-[clamp(220px,42vw,640px)]')
    expect(topBarSource).toContain('titlebar-no-drag min-w-0 shrink-0')
    expect(exportDialogSource).toContain('NOVEL_EXPORT_SECTIONS')
    expect(exportDialogSource).toContain('mergeManuscript')
    expect(exportDialogSource).toContain("'writing.export.sections.manuscript'")
    expect(exportDialogSource).toContain("t('writing.export.title', '导出写作工作区')")
    expect(exportDialogSource).toContain("t('writing.export.action', '导出')")
    expect(exportDialogSource).toContain("manuscript: '正文'")
    expect(versionDialogSource).toContain("t('writing.version.title', '版本管理')")
    expect(versionDialogSource).toContain('onCreateVersion')
    expect(versionDialogSource).toContain('onRestore(version.hash)')
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
    expect(askAiSource).toContain('relaunchApp')
    expect(askAiSource).not.toContain("type: 'rewriteNovelSelection'")
    expect(askAiSource).not.toContain('onSendMessage(effectiveSessionId')
  })

  it('keeps the writing editor editable during background autosave so typing focus is not stolen', () => {
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')

    expect(editorPanelSource).not.toContain('editable={!saving}')
    expect(editorPanelSource).toContain('editable')
  })

  it('clears stale writing workspace state before probing a different root', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('novelWorkspaceRootRef')
    expect(appShellSource).toContain('nextCandidateRoots.has(currentNovelWorkspaceRoot)')
    expect(appShellSource).toContain('setNovelWorkspaceFiles([])')
  })

  it('refreshes writing workspace files after assistant-generated file changes', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('refreshNovelWorkspaceFiles')
    expect(appShellSource).toContain('latestNovelFileChanges.length === 0')
    expect(appShellSource).toContain('void refreshNovelWorkspaceFiles(novelWorkspaceRoot)')
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

  it('keeps novel file review controls in the workspace without rendering a top diff panel', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const multiDiffSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx', import.meta.url), 'utf-8')

    expect(editorPanelSource).not.toContain('NovelInlineReviewDiff')
    expect(editorPanelSource).not.toContain('novel-inline-review-diff')
    expect(editorPanelSource).not.toContain('ShikiDiffViewer')
    expect(editorPanelSource).not.toContain('UnifiedDiffViewer')
    expect(editorPanelSource).toContain('<TiptapMarkdownEditor')
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

  it('marks changed files with a dismissible green dot in the writing catalog', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const leftSidebarSource = readFileSync(new URL('../../app-shell/LeftSidebar.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('dismissedNovelReviewDotKeys')
    expect(appShellSource).toContain('pendingNovelReviewDotKeysByPath')
    expect(appShellSource).toContain('handleDismissNovelReviewDot')
    expect(appShellSource).toContain('reviewDot: hasNovelReviewDot(file.path) ?')
    expect(leftSidebarSource).toContain('reviewDot?:')
    expect(leftSidebarSource).toContain('link.reviewDot?.onDismiss()')
    expect(leftSidebarSource).toContain('bg-emerald-500')
  })

  it('syncs the selected writing document from disk when accepting review changes', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const acceptSource = appShellSource.slice(
      appShellSource.indexOf('const handleAcceptNovelChange'),
      appShellSource.indexOf('const handleRejectNovelChange')
    )

    expect(appShellSource).toContain('syncSelectedNovelDocumentFromDisk')
    expect(acceptSource).toContain('await syncSelectedNovelDocumentFromDisk(change.filePath)')
    expect(appShellSource).toContain('setNovelDocumentContent(content)')
    expect(appShellSource).toContain('setSavedNovelDocumentContent(content)')
    expect(appShellSource).toContain('novelDocumentDirty')
  })

  it('persists novel review decisions by session so accepted changes stay accepted after reload', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const localStorageSource = readFileSync(new URL('../../../lib/local-storage.ts', import.meta.url), 'utf-8')

    expect(localStorageSource).toContain('novelChangeReviewStatus')
    expect(appShellSource).toContain('parseNovelReviewStatusMap')
    expect(appShellSource).toContain('persistNovelChangeReviewStatus')
    expect(appShellSource).toContain('storage.KEYS.novelChangeReviewStatus')
    expect(appShellSource).toContain('storage.get<Record<string, unknown>>(storage.KEYS.novelChangeReviewStatus')
    expect(appShellSource).toContain('storage.set(storage.KEYS.novelChangeReviewStatus')
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

  it('exposes a top-bar global search button backed by the global search dialog', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const topBarSource = readFileSync(new URL('../../app-shell/TopBar.tsx', import.meta.url), 'utf-8')
    const globalSearchSource = readFileSync(new URL('../../app-shell/GlobalSearchDialog.tsx', import.meta.url), 'utf-8')

    expect(topBarSource).toContain('onOpenGlobalSearch')
    expect(topBarSource).toContain('aria-label={t("globalSearch.open"')
    expect(topBarSource).toContain('<Icons.Search')
    expect(appShellSource).toContain('const [globalSearchOpen, setGlobalSearchOpen]')
    expect(appShellSource).toContain("useAction('app.search', () => setGlobalSearchOpen(true))")
    expect(appShellSource).toContain('<GlobalSearchDialog')
    expect(globalSearchSource).toContain('buildGlobalSearchResults')
    expect(globalSearchSource).toContain('onOpenSession')
    expect(globalSearchSource).toContain('onOpenNovelFile')
  })

  it('keeps the global search button visible in compact top-bar layout', () => {
    const topBarSource = readFileSync(new URL('../../app-shell/TopBar.tsx', import.meta.url), 'utf-8')

    expect(topBarSource).toContain('const globalSearchButton =')
    expect(topBarSource).toContain('{isCompact ? globalSearchButton : null}')
    expect(topBarSource).toContain('{!isCompact && (')
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
