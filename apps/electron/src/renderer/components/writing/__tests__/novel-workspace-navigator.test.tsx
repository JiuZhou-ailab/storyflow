// input: Novel workspace file projections, review changes, and renderer callbacks
// output: Regression coverage for the Cursor-style writing workspace layout and inline review UI
// pos: Keeps writing catalog navigation in the app shell and document editing in the navigator column

import * as React from 'react'
import { existsSync, readFileSync } from 'fs'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import { initReactI18next } from 'react-i18next'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

setupI18n([initReactI18next])

let NovelDocumentEditorPanel: typeof import('../NovelDocumentEditorPanel').NovelDocumentEditorPanel
let countMarkdownTextCharacters: typeof import('../NovelDocumentEditorPanel').countMarkdownTextCharacters
let NovelSectionList: typeof import('../NovelSectionList').NovelSectionList

function readSourceIfExists(url: URL): string {
  return existsSync(url) ? readFileSync(url, 'utf-8') : ''
}

beforeAll(async () => {
  const editorModule = await import('../NovelDocumentEditorPanel')
  const listModule = await import('../NovelSectionList')
  NovelDocumentEditorPanel = editorModule.NovelDocumentEditorPanel
  countMarkdownTextCharacters = editorModule.countMarkdownTextCharacters
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

  it('counts punctuation while folding ellipsis variants as one writing character', () => {
    expect(countMarkdownTextCharacters('他说：“你好。”')).toBe(8)
    expect(countMarkdownTextCharacters('番茄……起点......结束。')).toBe(9)
  })

  it('renders mergeable review changes through the native TipTap diff surface', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' }}
        content={'# 第一章\n\n她走进明亮的房间。\n\n尾声'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChanges={[{
          id: 'change-1',
          filePath: '/novel/story/chapters/chapter-01.md',
          toolType: 'Edit',
          original: '安静的房间',
          modified: '明亮的房间',
        }]}
      />
    )

    expect(html).not.toContain('data-testid="novel-file-review-diff"')
    expect(html).toContain('tiptap-editor--with-toolbar')
  })

  it('keeps unified-diff review changes out of the editable manuscript fallback panel', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' }}
        content={'# 第一章\n\n她走进明亮的房间。\n\n尾声'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChanges={[{
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
        }]}
      />
    )

    expect(html).not.toContain('data-testid="novel-file-review-diff"')
    expect(html).not.toContain('Snippet diffs')
    expect(html).toContain('tiptap-editor--with-toolbar')
  })

  it('renders multiline review changes without replacing the editable manuscript', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/正文/01.md', relativePath: '正文/01.md' }}
        content={'# 第一章\n\n- 第一段\n- 第二段'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChanges={[{
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
        }]}
      />
    )

    expect(html).not.toContain('data-testid="novel-file-review-diff"')
    expect(html).not.toContain('Snippet diffs')
    expect(html).toContain('tiptap-editor--with-toolbar')
    expect(html).not.toContain('novel-rendered-review-document')
  })

  it('keeps new Chinese manuscript unified diffs in the single editable surface', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/正文/02.md', relativePath: '正文/02.md' }}
        content={'# 第二章\n\n她推开门。\n\n风从长廊尽头吹来。'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChanges={[{
          id: 'change-1',
          filePath: '/novel/正文/02.md',
          toolType: 'Edit',
          original: '',
          modified: '',
          unifiedDiff: [
            'diff --git a/dev/null b/正文/02.md',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/正文/02.md',
            '@@ -0,0 +1,5 @@',
            '+# 第二章',
            '+',
            '+她推开门。',
            '+',
            '+风从长廊尽头吹来。',
          ].join('\n'),
        }]}
      />
    )

    expect(html).not.toContain('data-testid="novel-file-review-diff"')
    expect(html).not.toContain('Snippet diffs')
    expect(html).toContain('tiptap-editor--with-toolbar')
  })

  it('renders write-created manuscript files through the native TipTap diff surface', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/正文/03.md', relativePath: '正文/03.md' }}
        content={'# 第三章\n\n她停在窗前。'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChanges={[{
          id: 'change-1',
          filePath: '/novel/正文/03.md',
          toolType: 'Write',
          original: '',
          modified: '# 第三章\n\n她停在窗前。',
        }]}
      />
    )

    expect(html).not.toContain('data-testid="novel-file-review-diff"')
    expect(html).toContain('tiptap-editor--with-toolbar')
  })

  it('keeps the editable manuscript as the only surface when a review change cannot be merged into a file diff', () => {
    const html = renderToStaticMarkup(
      <NovelDocumentEditorPanel
        file={{ path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' }}
        content={'# 第一章\n\n她走进明亮的房间。'}
        loading={false}
        saving={false}
        onChange={() => {}}
        reviewChanges={[{
          id: 'change-1',
          filePath: '/novel/story/chapters/chapter-01.md',
          toolType: 'Edit',
          original: '安静的房间',
          modified: '重复的房间',
        }]}
      />
    )

    expect(html).toContain('tiptap-editor--with-toolbar')
    expect(html).not.toContain('data-testid="novel-file-review-diff"')
    expect(html).not.toContain('Snippet diffs')
    expect(html).not.toContain('data-testid="novel-inline-review-document"')
    expect(html).not.toContain('data-testid="novel-rendered-review-document"')
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
    expect(tiptapEditorStyles).toContain('--tiptap-manuscript-width: min(100%, 920px)')
    expect(tiptapEditorStyles).toContain('--tiptap-manuscript-line-height: 1.2')
    expect(tiptapEditorStyles).toContain('--tiptap-manuscript-paragraph-spacing: 0')
    expect(tiptapEditorStyles).toContain('line-height: var(--tiptap-manuscript-line-height)')
    expect(tiptapEditorStyles).toContain('margin: 0')
    expect(tiptapEditorStyles).toContain('.tiptap-editor--manuscript .tiptap-prose p + p')
    expect(tiptapEditorStyles).toContain('margin-top: var(--tiptap-manuscript-paragraph-spacing)')
    expect(tiptapEditorStyles).toContain('text-wrap: pretty')
    expect(tiptapEditorStyles).not.toContain('--tiptap-manuscript-width: 720px')
    expect(tiptapEditorStyles).toContain('.tiptap-editor--line-numbers .tiptap-prose')
    expect(tiptapEditorStyles).toContain('.tiptap-editor-status-badge')
  })

  it('keeps the selected manuscript range visibly highlighted while the selection AI input is focused', () => {
    const tiptapEditorSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx', import.meta.url), 'utf-8')
    const tiptapBubbleSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/markdown/TiptapBubbleMenus.tsx', import.meta.url), 'utf-8')
    const tiptapEditorStyles = readFileSync(new URL('../../../../../../../packages/ui/src/components/markdown/tiptap-editor.css', import.meta.url), 'utf-8')

    expect(tiptapEditorSource).toContain('SelectionAiRangeHighlight')
    expect(tiptapBubbleSource).toContain('SELECTION_AI_RANGE_HIGHLIGHT_KEY')
    expect(tiptapBubbleSource).toContain("class: 'selection-ai-range-highlight'")
    expect(tiptapBubbleSource).toContain('setSelectionAiRangeHighlight(editor, { from: selection.from, to: selection.to })')
    expect(tiptapBubbleSource).toContain('setSelectionAiRangeHighlight(editor, null)')
    expect(tiptapEditorStyles).toContain('.selection-ai-range-highlight')
  })

  it('routes selected novel text through chat when available so resulting file edits have diffs', () => {
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf-8')
    const sessionManagerSource = readFileSync(new URL('../../../../../../../packages/server-core/src/sessions/SessionManager.ts', import.meta.url), 'utf-8')
    const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf-8')
    const tiptapBubbleSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/markdown/TiptapBubbleMenus.tsx', import.meta.url), 'utf-8')

    expect(editorPanelSource).toContain('onAskAiForSelection')
    expect(editorPanelSource).toContain('onSendSelectionToChat')
    expect(editorPanelSource).toContain('formatNovelSelectionChatMessage')
    expect(appShellSource).toContain('handleAskAiForNovelSelection')
    expect(appShellSource).toContain('handleSendNovelSelectionToChat')
    expect(appShellSource).toContain('selectedNovelFile.path')
    expect(appShellSource).toContain('window.electronAPI.rewriteNovelSelection')
    expect(appShellSource).toContain('relaunchApp')
    expect(appShellSource).not.toContain("type: 'rewriteNovelSelection'")
    expect(tiptapBubbleSource).toContain('onAddSelectionToChat')
    expect(tiptapBubbleSource).toContain('insertContentAt({ from: selectionRange.from, to: selectionRange.to }, replacement')
    expect(tiptapBubbleSource).toContain("contentType: 'markdown'")
    expect(appShellSource).toContain('handleNovelWorkspaceSendMessage(effectiveSessionId')
    expect(appShellSource).toContain('onInputChange(effectiveSessionId, nextDraft)')
    expect(appShellSource).not.toContain('buildNovelSelectionOneTimeContext')
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
    expect(chatPageSource).toContain('ConversationHistoryMenuItems')
    expect(chatPageSource).toContain('{open ? (')
    expect(chatPageSource).toContain('useAtomValue(sessionMetaMapAtom)')
    expect(chatPageSource).toContain('routes.view.allSessions(item.id)')
    expect(historyMenuSource).toContain('<PanelHeaderCenterButton')
    expect(historyMenuSource).toContain("title={t('chat.history')}")
    expect(historyMenuSource).toContain('icon={<History className="h-4 w-4" />}')
    expect(chatPageSource).toContain('<SquarePenRounded className="h-4 w-4" />')
    expect(chatPageSource).toContain('<span className="text-[11px] font-medium leading-none">{t("session.newSession")}</span>')
    expect(chatPageSource).toContain('const headerLeadingAction = React.useMemo(() => leadingAction')
    expect(chatPageSource).toContain('{newSessionButton}')
    expect(chatPageSource.indexOf('{newSessionButton}')).toBeGreaterThan(chatPageSource.indexOf('const headerActions = React.useMemo'))
    expect(chatPageSource.indexOf('{newSessionButton}')).toBeLessThan(chatPageSource.indexOf('{conversationHistoryMenu}'))
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

  it('moves primary workspace navigation into the left activity rail', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const activityRailSource = readFileSync(new URL('../../app-shell/ActivityRail.tsx', import.meta.url), 'utf-8')
    const panelStackSource = readFileSync(new URL('../../app-shell/PanelStackContainer.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('<ActivityRail')
    expect(appShellSource).toContain('activeItem={activeActivityRailItem}')
    expect(appShellSource).toContain('onOpenWritingWorkspace={handleAllSessionsClick}')
    expect(appShellSource).toContain('onOpenSources={handleSourcesClick}')
    expect(appShellSource).toContain('onOpenSkills={handleSkillsClick}')
    expect(appShellSource).toContain("onOpenSettings={() => handleSettingsClick('app')}")
    expect(activityRailSource).toContain('label="写作工作区"')
    expect(activityRailSource).toContain('label="数据源"')
    expect(activityRailSource).toContain('label="技能"')
    expect(activityRailSource).toContain('label="设置"')
    expect(appShellSource).toContain('getPrimarySidebarLinks(novelWorkspaceSidebarLinks)')
    expect(appShellSource).toContain('links={primarySidebarLinks}')
    expect(appShellSource).not.toContain('novelWorkspaceUtilitySidebarLinks')
    expect(appShellSource).not.toContain('workspaceTools={showNovelWorkspaceSidebar ? (')
    expect(appShellSource).not.toContain('rightTools={showNovelWorkspaceSidebar ? (')
    expect(appShellSource).not.toContain('links={showNovelWorkspaceSidebar ? novelWorkspaceSidebarLinks : [')
    expect(appShellSource).not.toContain('[...novelWorkspaceUtilitySidebarLinks, ...novelWorkspaceSidebarLinks]')
    expect(panelStackSource).toContain('data-panel-role="content-scroll"')
    expect(panelStackSource.indexOf('data-panel-role="navigator"')).toBeLessThan(
      panelStackSource.indexOf('data-panel-role="content-scroll"')
    )
    expect(panelStackSource.indexOf('ref={scrollRef}')).toBeGreaterThan(
      panelStackSource.indexOf('data-panel-role="content-scroll"')
    )
  })

  it('roots the writing catalog at the current project and folds real paths into folders', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const sidebarSource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceSidebarLinks'),
      appShellSource.indexOf('const primarySidebarLinks')
    )
    const treeBuilderSource = appShellSource.slice(
      appShellSource.indexOf('function buildNovelWorkspaceFileTreeItems'),
      appShellSource.indexOf('function getContentChangeSize')
    )

    expect(sidebarSource).toContain('const projectSidebarId = `writing:project:${activeWorkspaceId ?? novelWorkspaceRoot}`')
    expect(sidebarSource).toContain("title: activeWorkspace?.name ?? t('writing.workspace')")
    expect(sidebarSource).toContain('tooltip: novelWorkspaceRoot')
    expect(sidebarSource).toContain('items: fileTreeItems')
    expect(treeBuilderSource).toContain("id = `writing:folder:${node.relativePath}`")
    expect(treeBuilderSource).toContain('title: getNovelWorkspaceFileName(file)')
    expect(treeBuilderSource).toContain('icon: Folder')
    expect(treeBuilderSource).toContain('countNovelWorkspaceTreeFiles(node)')
    expect(treeBuilderSource).not.toContain('categorizeNovelPath')
  })

  it('renders compact writing file titles with a softer two-line clamp', () => {
    const leftSidebarSource = readFileSync(new URL('../../app-shell/LeftSidebar.tsx', import.meta.url), 'utf-8')

    expect(leftSidebarSource).toContain('const titleClassName')
    expect(leftSidebarSource).toContain('link.compact')
    expect(leftSidebarSource).toContain('line-clamp-2')
    expect(leftSidebarSource).toContain('leading-[1.25]')
    expect(leftSidebarSource).toContain('min-h-[34px]')
  })

  it('collapses writing file create and import actions behind one menu trigger', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const sidebarSource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceSidebarLinks'),
      appShellSource.indexOf('const primarySidebarLinks')
    )

    expect(appShellSource).toContain('novelCreateFileTarget')
    expect(appShellSource).toContain('handleSubmitNovelCreateFile')
    expect(appShellSource).toContain('window.electronAPI.createDirectory(parentPath)')
    expect(appShellSource).toContain('window.electronAPI.writeFile(targetPath,')
    expect(appShellSource).toContain('handleImportNovelFiles')
    expect(appShellSource).toContain('window.electronAPI.openFileDialog()')
    expect(appShellSource).toContain('getNovelImportTargetRelativePath')
    expect(sidebarSource).toContain('const createNovelWorkspaceRootActions = () =>')
    expect(sidebarSource).toContain("void handleImportNovelFiles('正文')")
    expect(sidebarSource).toContain("void handleImportNovelFiles('全局')")
    expect(sidebarSource).toContain("void handleImportNovelFiles('自由区')")
    expect(sidebarSource).toContain("t('writing.createFile.globalInfo', '新建全局信息文件')")
    expect(sidebarSource).toContain("t('writing.importFile.globalInfo', '导入全局信息文件')")
    expect(sidebarSource).toContain('const createMenuTrigger = (menuTitle: string) =>')
    expect(sidebarSource).toContain('<DropdownMenu>')
    expect(sidebarSource).toContain('<DropdownMenuTrigger asChild>')
    expect(sidebarSource).toContain('<MoreHorizontal className="h-3 w-3" />')
    expect(sidebarSource).toContain('<StyledDropdownMenuItem')
    expect(sidebarSource).toContain('afterTitle: createNovelWorkspaceRootActions()')
    expect(sidebarSource).not.toContain('const createNovelWorkspaceAddAction =')
    expect(sidebarSource).not.toContain('const createNovelWorkspaceImportAction =')
    expect(appShellSource).toContain('placeholder={novelCreateFileTarget?.placeholder}')
    expect(appShellSource).toContain('normalizeNovelCreateFilePath')
    expect(appShellSource).toContain('shouldCreateMarkdownStarter(relativePath)')
    expect(sidebarSource).toContain("placeholder: '07-标题、07-标题.md 或 第一卷/07-标题.txt'")
    expect(sidebarSource).toContain("placeholder: '角色/主角、世界观/城市.md 或 补充设定.txt'")
    expect(sidebarSource).toContain("placeholder: '脑洞、脑洞.md 或 临时/脑洞.txt'")
  })

  it('keeps the native writing file tree ordered by filesystem path instead of custom catalog order', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const leftSidebarSource = readFileSync(new URL('../../app-shell/LeftSidebar.tsx', import.meta.url), 'utf-8')
    const sidebarSource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceSidebarLinks'),
      appShellSource.indexOf('const primarySidebarLinks')
    )

    expect(appShellSource).not.toContain('NovelWorkspaceCatalogOrder')
    expect(appShellSource).not.toContain('novelWorkspaceCatalogOrder')
    expect(appShellSource).not.toContain('novelWorkspaceSidebarItemOrders')
    expect(appShellSource).not.toContain('orderSidebarItemsByStoredIds')
    expect(sidebarSource).not.toContain('reorderable: true')
    expect(sidebarSource).not.toContain('onItemsReorder')
    expect(leftSidebarSource).toContain('import { SortableList }')
    expect(leftSidebarSource).toContain('onLinksReorder={link.reorderable ? link.onItemsReorder : undefined}')
    expect(leftSidebarSource).toContain('<SortableList')
    expect(sidebarSource).not.toContain("t('writing.catalog.manuscriptFirst', '正文置顶')")
    expect(sidebarSource).not.toContain("t('writing.catalog.globalFirst', '全局信息置顶')")
  })

  it('exposes file-level add and delete controls for writable novel files', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const sidebarSource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceSidebarLinks'),
      appShellSource.indexOf('const primarySidebarLinks')
    )

    expect(appShellSource).toContain('const handleDeleteNovelWorkspaceFile = React.useCallback')
    expect(appShellSource).toContain('window.confirm(')
    expect(appShellSource).toContain('await window.electronAPI.deleteFile(file.path)')
    expect(appShellSource).toContain('novelWorkspaceFilesCacheRef.current.delete(novelWorkspaceRoot)')
    expect(sidebarSource).toContain('const createNovelWorkspaceFileItemActions = (')
    expect(sidebarSource).toContain('openNovelCreateFileDialog({')
    expect(sidebarSource).toContain("title: t('writing.createFile.nearby', '新建同目录文件')")
    expect(sidebarSource).toContain("t('writing.deleteFile.title', '删除文件')")
    expect(sidebarSource).toContain('renderFileActions: createNovelWorkspaceFileItemActions')
    expect(appShellSource).toContain('const basePath = getNovelFileCreateBasePath(file)')
    expect(appShellSource).not.toContain('createNovelWorkspaceFileItemActions(file, sectionId)')
  })

  it('uses current novel project history instead of global release notes in novel utility navigation', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const novelKeyboardItemsSource = appShellSource.slice(
      appShellSource.indexOf('const unifiedSidebarItems'),
      appShellSource.indexOf('// Toggle folder expanded state')
    )
    const novelWorkspaceActionsSource = appShellSource.slice(
      appShellSource.indexOf('workspaceActions={('),
      appShellSource.indexOf('</NovelDocumentEditorPanel>', appShellSource.indexOf('workspaceActions={('))
    )

    expect(appShellSource).not.toContain('nav:writing-version')
    expect(appShellSource).not.toContain('nav:whats-new')
    expect(novelWorkspaceActionsSource).not.toContain('handleWhatsNewClick')
    expect(novelKeyboardItemsSource).not.toContain("result.push({ id: 'nav:writing-version'")
    expect(novelKeyboardItemsSource).not.toContain("result.push({ id: 'nav:whats-new'")
    expect(novelWorkspaceActionsSource).toContain("tooltip={t('writing.version.title', '版本管理')}")
    expect(novelWorkspaceActionsSource).toContain('setNovelVersionDialogOpen(true)')
  })

  it('renders the writing catalog as a native project file tree instead of classified sections', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const sidebarSource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceSidebarLinks'),
      appShellSource.indexOf('const primarySidebarLinks')
    )

    expect(sidebarSource).toContain('const projectSidebarId = `writing:project:${activeWorkspaceId ?? novelWorkspaceRoot}`')
    expect(sidebarSource).toContain('buildNovelWorkspaceFileTreeItems(novelWorkspaceFiles')
    expect(sidebarSource).toContain('title: activeWorkspace?.name ?? t(\'writing.workspace\')')
    expect(sidebarSource).not.toContain('globalSectionDefinitions')
    expect(sidebarSource).not.toContain('NOVEL_WORKSPACE_GLOBAL_GROUP_ID')
    expect(sidebarSource).not.toContain('formatNovelWorkspaceFileTitle(file, t)')
  })

  it('exposes selectable writing workspace export controls', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const exportDialogSource = readFileSync(new URL('../NovelExportDialog.tsx', import.meta.url), 'utf-8')
    const versionDialogSource = readFileSync(new URL('../NovelVersionHistoryDialog.tsx', import.meta.url), 'utf-8')
    const topBarSource = readFileSync(new URL('../../app-shell/TopBar.tsx', import.meta.url), 'utf-8')
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const zhHansLocale = JSON.parse(readFileSync(new URL('../../../../../../../packages/shared/src/i18n/locales/zh-Hans.json', import.meta.url), 'utf-8'))
    const exportHandlerSource = appShellSource.slice(
      appShellSource.indexOf('const handleExportNovelWorkspace'),
      appShellSource.indexOf('const novelReviewUndoStackRef')
    )

    expect(appShellSource).toContain('NovelExportDialog')
    expect(appShellSource).toContain('NovelVersionHistoryDialog')
    expect(appShellSource).toContain('handleExportNovelWorkspace')
    expect(appShellSource).toContain('handleCreateNovelVersion')
    expect(appShellSource).toContain('handleRestoreNovelVersion')
    expect(appShellSource).toContain('setNovelExportDialogOpen(true)')
    expect(appShellSource).toContain('setNovelVersionDialogOpen(true)')
    expect(appShellSource).toContain('workspaceActions={(')
    expect(appShellSource).toContain('buildNovelExportPlan')
    expect(appShellSource).toContain('buildMergedManuscriptContent')
    expect(appShellSource).toContain('NOVEL_AUTO_VERSION_CHAR_THRESHOLD = 100')
    expect(appShellSource).toContain('NOVEL_AUTO_VERSION_INTERVAL_MS = 5 * 60 * 1000')
    expect(appShellSource).toContain('novelAutoVersionTimerRef')
    expect(appShellSource).toContain("window.electronAPI.createWorkspaceVersion(novelWorkspaceRoot, { reason: 'auto' })")
    expect(appShellSource).toContain('window.electronAPI.listWorkspaceVersions(novelWorkspaceRoot, 30)')
    expect(appShellSource).toContain('window.electronAPI.restoreWorkspaceVersion(novelWorkspaceRoot, commitHash)')
    expect(exportHandlerSource.indexOf('await window.electronAPI.createDirectory(exportRootPath)')).toBeLessThan(
      exportHandlerSource.indexOf('await window.electronAPI.writeFile(targetPath')
    )
    expect(topBarSource).not.toContain('rightTools?: React.ReactNode')
    expect(topBarSource).not.toContain('{rightTools ? (')
    expect(editorPanelSource).toContain('workspaceActions?: React.ReactNode')
    expect(editorPanelSource).toContain('{workspaceActions ? (')
    expect(topBarSource).toContain('data-testid="window-title-bar"')
    expect(topBarSource).not.toContain('ml-auto flex min-w-0 flex-1 items-center justify-end gap-1')
    expect(topBarSource).not.toContain('w-[clamp(220px,42vw,640px)]')
    expect(topBarSource).not.toContain('titlebar-no-drag min-w-0 shrink-0')
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
      appShellSource.indexOf('const fileItem = (file: NovelWorkspaceFile): LeftSidebarItem => ({'),
      appShellSource.indexOf('const folderItem =')
    )
    const askAiSource = appShellSource.slice(
      appShellSource.indexOf('const handleAskAiForNovelSelection'),
      appShellSource.indexOf('const navigatorPanelWidth')
    )

    expect(appShellSource).toContain('handleSelectNovelFile')
    expect(appShellSource).toContain('ensureNovelDocumentSaved')
    expect(appShellSource).toContain('window.setTimeout')
    expect(appShellSource).toContain('window.clearTimeout')
    expect(fileItemSource).toContain('options.onSelectFile(file)')
    expect(fileItemSource).not.toContain('setSelectedNovelFilePath(file.path)')
    expect(askAiSource).toContain('const saved = await ensureNovelDocumentSaved()')
    expect(askAiSource).not.toContain('writing.askAiBlockedByUnsavedEdits')
    expect(askAiSource).toContain('window.electronAPI.rewriteNovelSelection')
    expect(askAiSource).toContain('relaunchApp')
    expect(askAiSource).not.toContain("type: 'rewriteNovelSelection'")
    expect(askAiSource).toContain('handleNovelWorkspaceSendMessage(effectiveSessionId')
  })

  it('keeps the writing editor editable during background autosave so typing focus is not stolen', () => {
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')

    expect(editorPanelSource).not.toContain('editable={!saving}')
    expect(editorPanelSource).toContain('editable')
  })

  it('keeps long manuscript edits in TipTap until save boundaries pull a snapshot', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const autosaveSource = appShellSource.slice(
      appShellSource.indexOf('React.useEffect(() => {\n    if (!selectedNovelDocumentPath || !novelDocumentDirty || novelDocumentLoading) return'),
      appShellSource.indexOf('const ensureNovelDocumentSaved =')
    )
    const ensureSaveSource = appShellSource.slice(
      appShellSource.indexOf('const ensureNovelDocumentSaved ='),
      appShellSource.indexOf('const handleAllSessionsClick')
    )
    const renderSource = appShellSource.slice(
      appShellSource.indexOf('<NovelDocumentEditorPanel'),
      appShellSource.indexOf('reviewChanges={selectedNovelPendingChanges}')
    )

    expect(editorPanelSource).toContain('export interface NovelDocumentEditorPanelHandle')
    expect(editorPanelSource).toContain('getMarkdownSnapshot(): string')
    expect(editorPanelSource).toContain('onDocumentChanged?: () => void')
    expect(editorPanelSource).toContain('ref={editorRef}')
    expect(editorPanelSource).toContain('key={file.path}')
    expect(editorPanelSource).toContain('onDocumentChanged={onDocumentChanged}')
    expect(editorPanelSource).not.toContain('onUpdate={onChange}')
    expect(appShellSource).toContain('novelDocumentEditorRef')
    expect(appShellSource).toContain('handleNovelDocumentChanged')
    expect(appShellSource).toContain('getCurrentNovelDocumentContent')
    expect(autosaveSource).toContain('const contentToSave = getCurrentNovelDocumentContent()')
    expect(ensureSaveSource).toContain('const contentToSave = getCurrentNovelDocumentContent()')
    expect(renderSource).toContain('ref={novelDocumentEditorRef}')
    expect(renderSource).toContain('onDocumentChanged={handleNovelDocumentChanged}')
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

  it('creates git freshness checkpoints around writing workspace agent turns', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const storageSource = readFileSync(new URL('../../../lib/local-storage.ts', import.meta.url), 'utf-8')

    expect(storageSource).toContain("workspaceVersionKnownCommit: 'workspace-version-known-commit'")
    expect(appShellSource).toContain('prepareNovelWorkspaceBriefForSend')
    expect(appShellSource).toContain("reason: 'user-preprompt'")
    expect(appShellSource).toContain("reason: 'agent-turn'")
    expect(appShellSource).toContain('window.electronAPI.compareWorkspaceVersions')
    expect(appShellSource).toContain('oneTimeContext: mergeOneTimeContext')
  })

  it('hides the generic content panel close button in writing workspace mode', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const panelStackSource = readFileSync(new URL('../../app-shell/PanelStackContainer.tsx', import.meta.url), 'utf-8')
    const panelSlotSource = readFileSync(new URL('../../app-shell/PanelSlot.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('hidePanelCloseButton={showPrimarySidebar}')
    expect(panelStackSource).toContain('hidePanelCloseButton?: boolean')
    expect(panelStackSource).toContain('hideCloseButton={hidePanelCloseButton}')
    expect(panelSlotSource).toContain('hideCloseButton?: boolean')
    expect(panelSlotSource).toContain('if (hideCloseButton) return undefined')
  })

  it('keeps novel file review controls in the workspace and uses the editable manuscript as the only review surface', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const multiDiffSource = readFileSync(new URL('../../../../../../../packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx', import.meta.url), 'utf-8')

    expect(editorPanelSource).not.toContain('NovelInlineReviewDiff')
    expect(editorPanelSource).not.toContain('NovelRenderedReviewDocument')
    expect(editorPanelSource).not.toContain('novel-rendered-review-document')
    expect(editorPanelSource).not.toContain('NovelFileReviewDiff')
    expect(editorPanelSource).not.toContain('novel-file-review-diff')
    expect(editorPanelSource).not.toContain('ShikiDiffViewer')
    expect(editorPanelSource).not.toContain('UnifiedDiffViewer')
    expect(editorPanelSource).toContain('<TiptapMarkdownEditor')
    expect(appShellSource).toContain('reviewChanges={selectedNovelPendingChanges}')
    expect(appShellSource).toContain('handleAcceptNovelFileChanges')
    expect(appShellSource).toContain('handleRejectNovelFileChanges')
    expect(appShellSource).toContain('buildRejectFileChangesOperation')
    expect(appShellSource).toContain('handleAcceptAllNovelChanges')
    expect(appShellSource).toContain('void handleSelectNextNovelChangeAfterStatus(filePath, nextStatus)')
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
    expect(appShellSource).toContain('reviewDot: options.hasReviewDot(file.path) ?')
    expect(appShellSource).toContain('hasReviewDot: hasNovelReviewDot')
    expect(appShellSource).toContain('onDismissReviewDot: handleDismissNovelReviewDot')
    expect(leftSidebarSource).toContain('reviewDot?:')
    expect(leftSidebarSource).toContain('link.reviewDot?.onDismiss()')
    expect(leftSidebarSource).toContain('bg-emerald-500')
  })

  it('saves the selected writing document before accepting file-level review changes', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const acceptSource = appShellSource.slice(
      appShellSource.indexOf('const handleAcceptNovelFileChanges'),
      appShellSource.indexOf('const handleAcceptAllNovelChanges')
    )
    const acceptAllSource = appShellSource.slice(
      appShellSource.indexOf('const handleAcceptAllNovelChanges'),
      appShellSource.indexOf('const handleRejectNovelFileChanges')
    )

    expect(acceptSource).toContain('await ensureNovelDocumentSaved()')
    expect(acceptSource).toContain('buildRejectFileChangesOperation(reviewableChanges, currentContent)')
    expect(acceptAllSource).toContain('const pendingChangesByPath = new Map<string, FileChange[]>()')
    expect(acceptAllSource).toContain('pendingChangesByPath.has(selectedNovelFile.path)')
    expect(acceptAllSource).toContain('buildRejectFileChangesOperation(changes, currentContent)')
    expect(acceptAllSource).not.toContain('buildAcceptNovelChangeUndoEntry')
    expect(appShellSource).toContain('setNovelDocumentContent(content)')
    expect(appShellSource).toContain('setSavedNovelDocumentContent(content)')
    expect(appShellSource).toContain('novelDocumentDirty')
  })

  it('persists novel review decisions by workspace root so accepted changes stay accepted across sessions', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const reviewControllerSource = readSourceIfExists(new URL('../../../hooks/useNovelReviewController.ts', import.meta.url))
    const localStorageSource = readFileSync(new URL('../../../lib/local-storage.ts', import.meta.url), 'utf-8')

    expect(localStorageSource).toContain('novelChangeReviewStatus')
    expect(localStorageSource).toContain('workspace-root-scoped via suffix')
    expect(appShellSource).toContain('useNovelReviewController')
    expect(appShellSource).toContain('persistNovelChangeReviewStatus')
    expect(reviewControllerSource).toContain('parseNovelReviewStatusMap')
    expect(reviewControllerSource).toContain('storage.KEYS.novelChangeReviewStatus')
    expect(reviewControllerSource).toContain('storage.get<Record<string, unknown>>(storage.KEYS.novelChangeReviewStatus, {}, novelWorkspaceRoot)')
    expect(reviewControllerSource).toContain('storage.set(storage.KEYS.novelChangeReviewStatus, nextStatus, novelWorkspaceRoot)')
    expect(reviewControllerSource).toContain('storage.set(storage.KEYS.novelChangeReviewStatus, normalizedStatus, novelWorkspaceRoot)')
    expect(reviewControllerSource).toContain('getAdjacentChangedFilePath(')
    expect(reviewControllerSource).toContain('handleSelectNextNovelChangeAfterStatus')
    expect(reviewControllerSource).not.toContain('effectiveSessionId')
  })

  it('normalizes agent file-change paths before matching them to selected writing files', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const reviewControllerSource = readSourceIfExists(new URL('../../../hooks/useNovelReviewController.ts', import.meta.url))

    expect(appShellSource).toContain('normalizeNovelFileChangePaths(')
    expect(appShellSource).toContain('reviewableNovelFileChanges')
    expect(appShellSource).toContain('useNovelReviewController')
    expect(reviewControllerSource).toContain('getPendingChangesForFile(reviewableNovelFileChanges')
  })

  it('keeps the novel catalog sidebar scoped to writing mode while utility views use the navigator column', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const navigatorSlotSource = appShellSource.slice(
      appShellSource.indexOf('navigatorSlot={'),
      appShellSource.indexOf('navigatorWidth=')
    )

    expect(appShellSource).toContain('const showNovelWorkspaceSidebar = novelWorkspaceRootMatchesCandidates')
    expect(appShellSource).toContain('const showNovelDocumentNavigator = isSessionsNavigation(navState) && showNovelWorkspaceSidebar')
    expect(appShellSource).toContain('const hasUnsettledNovelWorkspaceCandidates = novelWorkspaceCandidateRoots.length > 0 && novelWorkspaceDetectionSettledKey !== novelWorkspaceCandidateKey')
    expect(appShellSource).toContain('const showNovelWorkspacePending = isSessionsNavigation(navState) && (')
    expect(appShellSource).toContain('const showNovelWorkspaceUnavailable = isSessionsNavigation(navState)')
    expect(appShellSource).toContain('setNovelWorkspaceDetecting(shouldKeepWorkspaceChromeWhileDetecting)')
    expect(appShellSource).toContain('(showNovelWorkspacePending || showNovelWorkspaceUnavailable) ? novelWorkspaceNavigatorWidth : sessionListWidth')
    expect(appShellSource).toContain('(showNovelWorkspacePending || showNovelWorkspaceUnavailable) ? [')
    expect(appShellSource).toContain("t('writing.loadingWorkspace'")
    expect(navigatorSlotSource).toContain(') : showNovelWorkspacePending ? (')
    expect(navigatorSlotSource).toContain(') : showNovelWorkspaceUnavailable ? (')
    expect(navigatorSlotSource.indexOf('showNovelWorkspacePending')).toBeLessThan(navigatorSlotSource.indexOf('<SessionList'))
    expect(navigatorSlotSource.indexOf('showNovelWorkspaceUnavailable')).toBeLessThan(navigatorSlotSource.indexOf('<SessionList'))
    expect(appShellSource).toContain('if (!showNovelWorkspaceSidebar) return []')
    expect(appShellSource).toContain('if (primarySidebarLinks.length > 0) {')
    expect(appShellSource).toContain('const showPrimarySidebar = hasPrimarySidebar && isSessionsNavigation(navState)')
    expect(appShellSource).toContain('sidebarWidth={effectiveSidebarAndNavigatorHidden ? 0 : (isSidebarVisible && showPrimarySidebar ? sidebarWidth : 0)}')
    expect(appShellSource).not.toContain('NovelWorkspaceUtilityTopNav')
    expect(appShellSource).not.toContain('workspaceTools={showNovelWorkspaceSidebar ? (')
    expect(appShellSource).toContain('getPrimarySidebarLinks(novelWorkspaceSidebarLinks)')
    expect(appShellSource).toContain('links={primarySidebarLinks}')
    expect(appShellSource).toContain('{showNovelDocumentNavigator && novelWorkspaceRoot ? (')
    expect(appShellSource).toContain('handleAllSessionsClick()')
  })

  it('does not derive writing workspace roots from a stale session outside the active workspace', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const workingDirectorySource = appShellSource.slice(
      appShellSource.indexOf('const activeSessionMeta ='),
      appShellSource.indexOf('const latestNovelFileChanges')
    )

    expect(workingDirectorySource).toContain('activeSessionMeta?.workspaceId === activeWorkspaceId')
    expect(workingDirectorySource).toContain('activeSessionMeta?.workspaceId === remoteWorkspaceId')
    expect(workingDirectorySource).toContain('? activeSessionMeta?.workingDirectory')
    expect(workingDirectorySource).not.toContain('? sessionMetaMap.get(effectiveSessionId)?.workingDirectory')
  })

  it('does not sync a stale focused-panel session into the selected session during workspace switches', () => {
    const navigationSource = readFileSync(new URL('../../../contexts/NavigationContext.tsx', import.meta.url), 'utf-8')
    const selectionSyncSource = navigationSource.slice(
      navigationSource.indexOf('// Keep the global session selection in sync with the focused panel'),
      navigationSource.indexOf('// =========================================================================', navigationSource.indexOf('// Keep the global session selection in sync with the focused panel') + 1)
    )

    expect(selectionSyncSource).toContain('const selectedSessionMeta = store.get(sessionMetaMapAtom).get(navigationState.details.sessionId)')
    expect(selectionSyncSource).toContain('selectedSessionMeta?.workspaceId === workspaceId')
    expect(selectionSyncSource).toContain('selectedSessionMeta?.workspaceId === remoteWorkspaceId')
    expect(selectionSyncSource.indexOf('if (!selectedSessionMatchesWorkspace) return')).toBeLessThan(
      selectionSyncSource.indexOf('setSession({ selected: navigationState.details.sessionId })')
    )
  })

  it('does not render a stale focused-panel session as the effective chat session during workspace switches', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const effectiveSessionSource = appShellSource.slice(
      appShellSource.indexOf('const rawEffectiveSessionId ='),
      appShellSource.indexOf('// Focus chat input for the target session only')
    )

    expect(effectiveSessionSource).toContain('const rawEffectiveSessionId = focusedSessionId ?? session.selected')
    expect(effectiveSessionSource).toContain('const rawEffectiveSessionMeta = rawEffectiveSessionId ? sessionMetaMap.get(rawEffectiveSessionId) : undefined')
    expect(effectiveSessionSource).toContain('rawEffectiveSessionMeta?.workspaceId === activeWorkspaceId')
    expect(effectiveSessionSource).toContain('rawEffectiveSessionMeta?.workspaceId === remoteWorkspaceId')
    expect(effectiveSessionSource).toContain('const effectiveSessionId = rawEffectiveSessionBelongsToWorkspace ? rawEffectiveSessionId : null')
  })

  it('does not render stale chat panel routes from another workspace during workspace switches', () => {
    const mainContentSource = readFileSync(new URL('../../app-shell/MainContentPanel.tsx', import.meta.url), 'utf-8')
    const sessionsContentSource = mainContentSource.slice(
      mainContentSource.indexOf('// Chats navigator - show chat, multi-select panel, or empty state'),
      mainContentSource.indexOf('// Fallback')
    )
    const sessionRouteContentSource = mainContentSource.slice(
      mainContentSource.indexOf('function SessionRouteContent'),
      mainContentSource.length
    )

    expect(sessionsContentSource).toContain('<SessionRouteContent')
    expect(sessionsContentSource).toContain('sessionId={navState.details.sessionId}')
    expect(sessionsContentSource).toContain('activeWorkspaceId={activeWorkspaceId}')
    expect(sessionsContentSource).toContain('remoteWorkspaceId={remoteWorkspaceId}')
    expect(mainContentSource).toContain('const selectedSessionMeta = useAtomValue(sessionMetaAtomFamily(sessionId))')
    expect(sessionRouteContentSource).toContain('selectedSessionMeta?.workspaceId === activeWorkspaceId')
    expect(sessionRouteContentSource).toContain('selectedSessionMeta?.workspaceId === remoteWorkspaceId')
    expect(sessionRouteContentSource.indexOf('if (!selectedSessionMatchesWorkspace)')).toBeLessThan(
      sessionRouteContentSource.indexOf('<ChatPage sessionId={sessionId} />')
    )
  })

  it('reconciles stale chat panel routes before content rendering observes them', () => {
    const navigationSource = readFileSync(new URL('../../../contexts/NavigationContext.tsx', import.meta.url), 'utf-8')
    const staleRouteReconcileSource = navigationSource.slice(
      navigationSource.indexOf('// STALE SESSION PANEL ROUTE RECONCILIATION'),
      navigationSource.indexOf('// AUTO-SELECT ON SESSION LOAD')
    )

    expect(staleRouteReconcileSource).toContain('const navState = parseRouteToNavigationState(entry.route)')
    expect(staleRouteReconcileSource).toContain('if (!navState || !isSessionsNavigation(navState) || !navState.details)')
    expect(staleRouteReconcileSource).toContain('const resolved = resolveAutoSelection(navState)')
    expect(staleRouteReconcileSource).toContain('store.set(reconcilePanelStackAtom')
    expect(navigationSource.indexOf('// STALE SESSION PANEL ROUTE RECONCILIATION')).toBeLessThan(
      navigationSource.indexOf('// AUTO-SELECT ON SESSION LOAD')
    )
  })

  it('reuses cached writing workspace files during project switches before refreshing from disk', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const detectionSource = appShellSource.slice(
      appShellSource.indexOf('async function detectNovelWorkspace'),
      appShellSource.indexOf('void detectNovelWorkspace()')
    )

    expect(appShellSource).toContain('novelWorkspaceFilesCacheRef.current.set(rootPath, files)')
    expect(detectionSource).toContain('const cachedNovelWorkspaceFiles = novelWorkspaceFilesCacheRef.current.get(rootPath)')
    expect(detectionSource.indexOf('setNovelWorkspaceFilesIfChanged(cachedNovelWorkspaceFiles)')).toBeLessThan(
      detectionSource.indexOf('loadNovelWorkspaceFiles(')
    )
  })

  it('keeps AppShell off the full active session atom during streaming updates', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const effectiveSessionSource = appShellSource.slice(
      appShellSource.indexOf('const effectiveSessionAtom = React.useMemo'),
      appShellSource.indexOf('const latestNovelFileChangesSignature')
    )

    expect(effectiveSessionSource).toContain('selectAtom(effectiveSessionAtom, session => session?.isProcessing === true, Object.is)')
    expect(effectiveSessionSource).toContain('selectAtom(effectiveSessionAtom, session => session?.sessionFolderPath, Object.is)')
    expect(effectiveSessionSource).toContain('selectAtom(effectiveSessionAtom, getNovelFileChangeActivityKey, Object.is)')
    expect(effectiveSessionSource).toContain('const effectiveSession = store.get(effectiveSessionAtom)')
    expect(appShellSource).not.toContain('useAtomValue(sessionAtomFamily(effectiveSessionId')
    expect(appShellSource).not.toContain('buildNovelWorkspaceTree')
  })

  it('loads metadata-known writing workspace roots without hot-path structure probing', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const loadSource = appShellSource.slice(
      appShellSource.indexOf('const loadNovelWorkspaceFiles ='),
      appShellSource.indexOf('const refreshNovelWorkspaceFiles')
    )
    const detectionSource = appShellSource.slice(
      appShellSource.indexOf('async function detectNovelWorkspace'),
      appShellSource.indexOf('void detectNovelWorkspace()')
    )

    expect(loadSource).toContain("loadNovelWorkspaceFileTree(rootPath, activeWorkspaceMethodPackId)")
    expect(detectionSource).toContain('const knownWritingWorkspaceRoot = rootPath === activeWritingWorkspaceRoot')
    expect(detectionSource).toContain('knownWritingWorkspaceRoot || Boolean(cachedNovelWorkspaceFiles)')
    expect(detectionSource).not.toContain('NOVEL_WORKSPACE_DETECTION_QUERIES.map')
  })

  it('loads known writing workspace roots through purpose-built file listing before search fallback', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const fileTreeSource = appShellSource.slice(
      appShellSource.indexOf('async function loadNovelWorkspaceFileTree'),
      appShellSource.indexOf('function mapFileSearchResultsToNativeNovelWorkspaceFiles')
    )
    const loadSource = appShellSource.slice(
      appShellSource.indexOf('const loadNovelWorkspaceFiles ='),
      appShellSource.indexOf('const refreshNovelWorkspaceFiles')
    )
    const refreshSource = appShellSource.slice(
      appShellSource.indexOf('const refreshNovelWorkspaceFiles ='),
      appShellSource.indexOf('const openNovelCreateFileDialog')
    )
    const detectionSource = appShellSource.slice(
      appShellSource.indexOf('async function detectNovelWorkspace'),
      appShellSource.indexOf('void detectNovelWorkspace()')
    )

    expect(loadSource).toContain('knownNovelWorkspace = false')
    expect(loadSource).toContain('if (knownNovelWorkspace)')
    expect(loadSource).toContain('loadNovelWorkspaceFileTree(rootPath, activeWorkspaceMethodPackId)')
    expect(fileTreeSource).toContain('RPC_CHANNELS.fs.LIST_FILES')
    expect(fileTreeSource).toContain('window.electronAPI.listWorkspaceFiles(rootPath, [...rootQueries])')
    expect(fileTreeSource.indexOf('window.electronAPI.listWorkspaceFiles')).toBeLessThan(
      fileTreeSource.indexOf('searchNovelWorkspaceFiles(rootPath')
    )
    expect(refreshSource).toContain('rootPath === novelWorkspaceRootRef.current || novelWorkspaceFilesCacheRef.current.has(rootPath)')
    expect(detectionSource).toContain('knownWritingWorkspaceRoot || Boolean(cachedNovelWorkspaceFiles)')
  })

  it('coalesces writing workspace file loads before refresh state updates', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const loadSource = appShellSource.slice(
      appShellSource.indexOf('const loadNovelWorkspaceFiles ='),
      appShellSource.indexOf('const refreshNovelWorkspaceFiles')
    )
    const refreshSource = appShellSource.slice(
      appShellSource.indexOf('const refreshNovelWorkspaceFiles ='),
      appShellSource.indexOf('const openNovelCreateFileDialog')
    )

    expect(appShellSource).toContain('novelWorkspaceLoadInFlightRef')
    expect(loadSource).toContain('const loadKey =')
    expect(loadSource).toContain('const inFlight = novelWorkspaceLoadInFlightRef.current.get(loadKey)')
    expect(loadSource).toContain('if (inFlight) return inFlight')
    expect(loadSource).toContain('novelWorkspaceLoadInFlightRef.current.set(loadKey, loadPromise)')
    expect(loadSource).toContain('novelWorkspaceLoadInFlightRef.current.delete(loadKey)')
    expect(refreshSource).toContain('const detectLoadKey = `${rootPath}\\ndetect`')
    expect(refreshSource).toContain('const detectInFlight = novelWorkspaceLoadInFlightRef.current.get(detectLoadKey)')
    expect(refreshSource.indexOf('const detectInFlight =')).toBeLessThan(
      refreshSource.indexOf('loadNovelWorkspaceFiles(')
    )
    expect(refreshSource).toContain('areNovelWorkspaceFilesEqual(previous, files) ? previous : files')
  })

  it('uses equality guarded writing workspace file updates during detection', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const detectionSource = appShellSource.slice(
      appShellSource.indexOf('async function detectNovelWorkspace'),
      appShellSource.indexOf('void detectNovelWorkspace()')
    )

    expect(appShellSource).toContain('const setNovelWorkspaceFilesIfChanged = React.useCallback')
    expect(detectionSource).toContain('setNovelWorkspaceFilesIfChanged(cachedNovelWorkspaceFiles)')
    expect(detectionSource).toContain('setNovelWorkspaceFilesIfChanged(probeFiles)')
    expect(detectionSource).toContain('setNovelWorkspaceFilesIfChanged(files)')
  })

  it('preserves the selected writing file when catalog refreshes temporarily omit it', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const selectionSource = appShellSource.slice(
      appShellSource.indexOf('const selectedNovelFile = React.useMemo'),
      appShellSource.indexOf('const [novelDocumentContent')
    )

    expect(selectionSource).toContain('if (!selectedNovelFilePath) return defaultNovelFile')
    expect(selectionSource).toContain('const listedFile = novelWorkspaceFiles.find(file => file.path === selectedNovelFilePath)')
    expect(selectionSource).toContain('isNovelWorkspaceFilePathInRoot(selectedNovelFilePath, novelWorkspaceRoot)')
    expect(selectionSource).toContain('relativePath: getNovelWorkspaceRelativePath(selectedNovelFilePath, novelWorkspaceRoot)')
    expect(selectionSource).not.toContain('?? defaultNovelFile')
    expect(selectionSource).not.toContain('if (!showNovelWorkspaceSidebar) {\n      setSelectedNovelFilePath(null)\n      return\n    }')
  })

  it('keeps the selected writing document stable while workspace detection is pending', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const selectionSource = appShellSource.slice(
      appShellSource.indexOf('const selectedNovelFile = React.useMemo'),
      appShellSource.indexOf('const [novelDocumentContent')
    )

    expect(selectionSource).toContain('const canResolveSelectedNovelFile = showNovelWorkspaceSidebar || showNovelWorkspacePending')
    expect(selectionSource).toContain('if (!canResolveSelectedNovelFile) return undefined')
    expect(selectionSource.indexOf('if (!canResolveSelectedNovelFile) return undefined')).toBeLessThan(
      selectionSource.indexOf('if (!selectedNovelFilePath) return defaultNovelFile')
    )
    expect(selectionSource).toContain('showNovelWorkspacePending')
  })

  it('uses the stable selected writing file path for click-switch save decisions', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const selectHandlerSource = appShellSource.slice(
      appShellSource.indexOf('const handleSelectNovelFile = React.useCallback'),
      appShellSource.indexOf('const handleSelectNovelFileByPath')
    )

    expect(selectHandlerSource).toContain('if (file.path === selectedNovelFilePath)')
    expect(selectHandlerSource.indexOf('if (file.path === selectedNovelFilePath)')).toBeLessThan(
      selectHandlerSource.indexOf('const saveStartedAt = performance.now()')
    )
    expect(selectHandlerSource).toContain("phase: 'saveBeforeSwitch'")
    expect(selectHandlerSource).toContain('novelDocumentSwitchStartRef.current =')
    expect(selectHandlerSource).not.toContain('file.path !== selectedNovelFile?.path')
  })

  it('falls back to single search calls when batch file search is unavailable or fails', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const searchHelperSource = appShellSource.slice(
      appShellSource.indexOf('async function searchNovelWorkspaceFiles'),
      appShellSource.indexOf('function getContentChangeSize')
    )

    expect(searchHelperSource).toContain('window.electronAPI.isChannelAvailable(RPC_CHANNELS.fs.SEARCH_BATCH)')
    expect(searchHelperSource).toContain('window.electronAPI.searchFilesBatch(rootPath, requests)')
    expect(searchHelperSource).toContain('return await window.electronAPI.searchFilesBatch(rootPath, requests)')
    expect(searchHelperSource).toContain('Promise.all(')
    expect(searchHelperSource).toContain('requests.map(async (request)')
    expect(searchHelperSource).toContain('window.electronAPI.searchFiles(rootPath, request.query, request.options)')
    expect(searchHelperSource).toContain('1000')
  })

  it('keeps the renderer editor away from the Node-only writing barrel', () => {
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const sharedPackageJson = JSON.parse(
      readFileSync(new URL('../../../../../../../packages/shared/package.json', import.meta.url), 'utf-8')
    )

    expect(editorPanelSource).not.toContain("from '@craft-agent/shared/writing'")
    expect(editorPanelSource).not.toContain('from "@craft-agent/shared/writing"')
    expect(sharedPackageJson.exports['./writing/selection-context']).toBe('./src/writing/selection-context.ts')
  })

  it('treats a previously detected writing workspace root as invalid during render once it leaves current candidates', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const visibilitySource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceCandidateRootSet ='),
      appShellSource.indexOf('const reviewableNovelFileChanges')
    )

    expect(visibilitySource).toContain('const novelWorkspaceRootMatchesCandidates = !!novelWorkspaceRoot && novelWorkspaceCandidateRootSet.has(novelWorkspaceRoot)')
    expect(visibilitySource).toContain('const hasStaleNovelWorkspaceRoot = !!novelWorkspaceRoot && novelWorkspaceCandidateRoots.length > 0 && !novelWorkspaceRootMatchesCandidates')
    expect(visibilitySource).toContain('const showNovelWorkspaceSidebar = novelWorkspaceRootMatchesCandidates')
    expect(visibilitySource).toContain('const showNovelWorkspacePending = isSessionsNavigation(navState) && (')
    expect(visibilitySource).toContain('const showNovelWorkspaceUnavailable = isSessionsNavigation(navState)')
    expect(visibilitySource).toContain('hasStaleNovelWorkspaceRoot')
    expect(visibilitySource).toContain('(!showNovelWorkspaceSidebar && hasUnsettledNovelWorkspaceCandidates)')
  })

  it('does not render the legacy session navigator on cold start before writing workspace detection settles', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const visibilitySource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceCandidateKey ='),
      appShellSource.indexOf('const reviewableNovelFileChanges')
    )
    const navigatorSlotSource = appShellSource.slice(
      appShellSource.indexOf('navigatorSlot={'),
      appShellSource.indexOf('navigatorWidth=')
    )

    expect(visibilitySource).toContain('const hasUnsettledNovelWorkspaceCandidates = novelWorkspaceCandidateRoots.length > 0 && novelWorkspaceDetectionSettledKey !== novelWorkspaceCandidateKey')
    expect(visibilitySource).toContain('(!showNovelWorkspaceSidebar && hasUnsettledNovelWorkspaceCandidates)')
    expect(navigatorSlotSource.indexOf('showNovelWorkspacePending')).toBeLessThan(navigatorSlotSource.indexOf('<SessionList'))
  })

  it('does not render the legacy session navigator after writing workspace detection misses', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const visibilitySource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceCandidateRootSet ='),
      appShellSource.indexOf('const reviewableNovelFileChanges')
    )
    const navigatorSizingSource = appShellSource.slice(
      appShellSource.indexOf('const navigatorPanelWidth ='),
      appShellSource.indexOf('React.useEffect(() => {', appShellSource.indexOf('const navigatorPanelWidth ='))
    )
    const primarySidebarSource = appShellSource.slice(
      appShellSource.indexOf('const primarySidebarLinks ='),
      appShellSource.indexOf('const hasPrimarySidebar')
    )
    const navigatorSlotSource = appShellSource.slice(
      appShellSource.indexOf('navigatorSlot={'),
      appShellSource.indexOf('navigatorWidth=')
    )

    expect(visibilitySource).toContain('novelWorkspaceCandidateRoots.length > 0')
    expect(visibilitySource).toContain('&& !showNovelWorkspaceSidebar')
    expect(visibilitySource).toContain('&& !showNovelWorkspacePending')
    expect(navigatorSizingSource).toContain('showNovelWorkspaceUnavailable')
    expect(primarySidebarSource).toContain('showNovelWorkspacePending || showNovelWorkspaceUnavailable')
    expect(navigatorSlotSource).toContain("t('writing.workspaceUnavailable'")
    expect(navigatorSlotSource.indexOf('showNovelWorkspaceUnavailable')).toBeLessThan(navigatorSlotSource.indexOf('<SessionList'))
  })

  it('exposes global search from the activity rail backed by the global search dialog', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const activityRailSource = readFileSync(new URL('../../app-shell/ActivityRail.tsx', import.meta.url), 'utf-8')
    const globalSearchSource = readFileSync(new URL('../../app-shell/GlobalSearchDialog.tsx', import.meta.url), 'utf-8')

    expect(activityRailSource).toContain('label="搜索"')
    expect(activityRailSource).toContain('<Search className="h-[18px] w-[18px]" />')
    expect(appShellSource).toContain('onOpenSearch={() => setGlobalSearchOpen(true)}')
    expect(appShellSource).toContain('const [globalSearchOpen, setGlobalSearchOpen]')
    expect(appShellSource).toContain("useAction('app.search', () => setGlobalSearchOpen(true))")
    expect(appShellSource).toContain('<GlobalSearchDialog')
    expect(globalSearchSource).toContain('buildGlobalSearchResults')
    expect(globalSearchSource).toContain('onOpenSession')
    expect(globalSearchSource).toContain('onOpenNovelFile')
  })

  it('keeps global search outside the top bar so compact layout does not hide it', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const topBarSource = readFileSync(new URL('../../app-shell/TopBar.tsx', import.meta.url), 'utf-8')
    const activityRailSource = readFileSync(new URL('../../app-shell/ActivityRail.tsx', import.meta.url), 'utf-8')

    expect(topBarSource).not.toContain('const globalSearchButton =')
    expect(topBarSource).not.toContain('{isCompact ? globalSearchButton : null}')
    expect(appShellSource).toContain('const showActivityRail = !isSidebarAndNavigatorHidden')
    expect(activityRailSource).toContain('label="搜索"')
  })

  it('left-aligns sidebar item content instead of letting writing catalog labels drift toward the center', () => {
    const leftSidebarSource = readFileSync(new URL('../../app-shell/LeftSidebar.tsx', import.meta.url), 'utf-8')

    expect(leftSidebarSource).toContain('"group flex w-full items-center justify-start gap-2 rounded-[6px] text-left text-[13px] select-none outline-none"')
    expect(leftSidebarSource).toContain(': "min-w-0 flex-1 truncate text-left"')
    expect(leftSidebarSource).toContain('<span className={titleClassName}>{link.title}</span>')
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
    expect(appShellSource).not.toContain('NOVEL_WORKSPACE_NAVIGATOR_MAX_WIDTH')
    expect(appShellSource).toContain('getNavigatorResizeMaxWidth')
    expect(appShellSource).toContain('assistantMinWidth: PANEL_MIN_WIDTH')
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
    expect(appShellSource).toContain("beginResize(isNovelWorkspaceNavigatorActive ? 'novel-workspace-navigator' : 'session-list', e)")
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
    expect(appShellSource).toContain('width: 0')
    expect(appShellSource).toContain('width: NAVIGATOR_SASH_HIT_WIDTH')
    expect(appShellSource).toContain('const NAVIGATOR_SASH_FLEX_MARGIN = -(PANEL_GAP / 2)')
    expect(appShellSource).not.toContain('relative w-0 h-full cursor-col-resize')
    expect(appShellSource).not.toContain('/* Navigator Resize Handle (absolute, hidden in focused mode) */')
  })

  it('starts navigator resizing only from the real separator instead of a shell capture zone', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).not.toContain('NAVIGATOR_SASH_CAPTURE_HALF_WIDTH')
    expect(appShellSource).not.toContain('handleNavigatorResizeBoundaryMouseDownCapture')
    expect(appShellSource).not.toContain('onMouseDownCapture={handleNavigatorResizeBoundaryMouseDownCapture}')
    expect(appShellSource).not.toContain('navigatorPanelRect.right + (PANEL_GAP / 2)')
    expect(appShellSource).toContain("beginResize(isNovelWorkspaceNavigatorActive ? 'novel-workspace-navigator' : 'session-list', e)")
  })
})
