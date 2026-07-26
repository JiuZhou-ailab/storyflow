// input: Novel workspace file projections, review changes, and renderer callbacks
// output: Regression coverage for disk-synced project navigation, lifecycle menus, and inline review UI
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
    expect(tiptapEditorStyles).toContain('--tiptap-manuscript-width: min(100%, 1120px)')
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
    const sidebarSource = readFileSync(new URL('../../workspace/WorkspaceProjectSidebar.tsx', import.meta.url), 'utf-8')
    const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('NovelDocumentEditorPanel')
    expect(appShellSource).toContain('<WorkspaceProjectSidebar')
    expect(sidebarSource).toContain('<WorkspaceFileTree')
    expect(appShellSource).not.toContain('<NovelWorkspaceNavigatorPanel')
    expect(chatPageSource).not.toContain('NovelWorkspacePanel')
    expect(chatPageSource).not.toContain('NovelWorkspaceNavigatorPanel')
    expect(chatPageSource).not.toContain('NovelDocumentEditorPanel')
    expect(chatPageSource).not.toContain('WritingChatDropdown')
  })

  it('roots the writing catalog at the current project and folds real paths into folders', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const treeSource = readFileSync(new URL('../../workspace/WorkspaceFileTree.tsx', import.meta.url), 'utf-8')
    const modelSource = readFileSync(new URL('../../workspace/workspace-file-tree-model.ts', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('<WorkspaceProjectSidebar')
    expect(appShellSource).toContain('workspaceName: activeWorkspace?.name')
    expect(appShellSource).toContain('rootPath: novelWorkspaceRoot')
    expect(appShellSource).toContain('files: novelWorkspaceFiles')
    expect(treeSource).toContain('data={data}')
    expect(treeSource).toContain('openByDefault={false}')
    expect(modelSource).toContain(`? \`writing:project:\${workspaceId}\``)
    expect(modelSource).toContain(`: \`writing:folder:\${node.relativePath}\``)
    expect(modelSource).toContain(`id: \`writing:file:\${file.path}\``)
    expect(modelSource).toContain('node.fileCount = children.reduce')
    expect(modelSource).toContain('.sort((left, right) => collator.compare(left.name, right.name))')
    expect(modelSource).not.toContain('categorizeNovelPath')
  })

  it('renders file titles in fixed-height virtual rows', () => {
    const rowSource = readFileSync(new URL('../../workspace/WorkspaceFileTreeRow.tsx', import.meta.url), 'utf-8')
    const treeSource = readFileSync(new URL('../../workspace/WorkspaceFileTree.tsx', import.meta.url), 'utf-8')

    expect(rowSource).toContain('min-w-0 flex-1 truncate text-left')
    expect(treeSource).toContain('const ROW_HEIGHT = 30')
    expect(treeSource).toContain('rowHeight={ROW_HEIGHT}')
    expect(treeSource).toContain('countVisibleRows')
    expect(treeSource).toContain('fitContent')
    expect(treeSource).toContain("rowClassName={fitContent ? '!min-w-0 overflow-hidden' : undefined}")
    expect(treeSource).toContain("? 'w-full overflow-hidden py-1")
    expect(rowSource).toContain("entry.type === 'root' || entry.type === 'directory'")
    expect(rowSource).toContain("(entry.type === 'root' || node.isSelected)")
    expect(rowSource).toContain("node.isFocused && entry.type !== 'root'")
    expect(rowSource).not.toContain('Library')
  })

  it('exposes writing create and import actions through row context menus', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const rowSource = readFileSync(new URL('../../workspace/WorkspaceFileTreeRow.tsx', import.meta.url), 'utf-8')
    const modelSource = readFileSync(new URL('../../workspace/workspace-file-tree-model.ts', import.meta.url), 'utf-8')
    const rootMenuSource = appShellSource.slice(
      appShellSource.indexOf("if (entry.type === 'root')"),
      appShellSource.indexOf("if (entry.type === 'file')"),
    )

    expect(appShellSource).toContain('workspaceCreateEntryTarget')
    expect(appShellSource).toContain('handleSubmitWorkspaceCreateEntry')
    expect(appShellSource).toContain('workspaceFileTreeRef.current?.open(id)')
    expect(appShellSource).toContain('window.electronAPI.createDirectory(targetPath)')
    expect(appShellSource).toContain('window.electronAPI.createDirectory(parentPath)')
    expect(appShellSource).toContain('window.electronAPI.writeFile(targetPath,')
    expect(appShellSource).toContain('handleImportNovelFiles')
    expect(appShellSource).toContain('window.electronAPI.openFileDialog()')
    expect(appShellSource).toContain('resolveWorkspaceImportRelativePath(parentRelativePath, sourcePath)')
    expect(appShellSource).toContain('const getNovelWorkspaceTreeMenuActions = React.useCallback')
    expect(appShellSource).toContain("t('writing.createFile.menu', '新建文件')")
    expect(appShellSource).toContain("t('writing.createFolder.menu', '新建文件夹')")
    expect(appShellSource).toContain("t('writing.importFile.menu', '导入文件')")
    expect(rootMenuSource).toContain("...createActions('')")
    expect(rootMenuSource).toContain("id: 'reveal-root'")
    expect(rootMenuSource).toContain("id: 'open-project-in-new-window'")
    expect(rootMenuSource).toContain("id: 'rename-project'")
    expect(rootMenuSource).toContain("id: 'remove-project'")
    expect(rootMenuSource).toContain("t('workspace.removeWorkspace')")
    expect(rootMenuSource).toContain('variant: \'destructive\'')
    expect(rootMenuSource).toContain('onRemoveProject(activeProjectId)')
    expect(rootMenuSource).not.toContain('children:')
    expect(rootMenuSource).not.toContain("id: 'open-sources'")
    expect(rootMenuSource).not.toContain("id: 'open-skills'")
    expect(appShellSource).not.toContain('create-manuscript')
    expect(appShellSource).not.toContain('create-global')
    expect(appShellSource).not.toContain('create-free')
    expect(rowSource).toContain('<StyledContextMenuContent')
    expect(rowSource).toContain('<StyledContextMenuItem')
    expect(rowSource).not.toContain('<StyledContextMenuSubTrigger')
    expect(rowSource).toContain("const ROOT_MENU_ITEM_CLASS =")
    expect(rowSource).toContain('context.getMenuActions?.(entry)')
    expect(rowSource).not.toContain('MoreHorizontal')
    expect(appShellSource).toContain('placeholder={workspaceCreateEntryTarget?.placeholder}')
    expect(appShellSource).toContain('resolveWorkspaceCreateRelativePath(')
    expect(appShellSource).toContain('shouldCreateMarkdownStarter(relativePath)')
    expect(modelSource).toContain("export type WorkspaceCreateEntryKind = 'file' | 'directory'")
    expect(modelSource).toContain("name = `${name}.md`")
  })

  it('refreshes the project tree from its real folder when the app regains focus', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const syncSource = appShellSource.slice(
      appShellSource.indexOf('const syncWorkspaceTreeFromDisk ='),
      appShellSource.indexOf('const selectedNovelFile = React.useMemo'),
    )

    expect(syncSource).toContain("window.addEventListener('focus', syncWorkspaceTreeFromDisk)")
    expect(syncSource).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)")
    expect(syncSource).toContain('novelWorkspaceCatalogCacheRef.current.delete(novelWorkspaceRoot)')
    expect(syncSource).toContain('refreshNovelWorkspaceFiles(novelWorkspaceRoot)')
    expect(syncSource).toContain("error.message.includes('Workspace not found')")
    expect(syncSource).toContain('setNovelWorkspaceCatalogIfChanged(emptyCatalog)')
    expect(syncSource).toContain('setSelectedNovelFilePath(null)')
  })

  it('keeps the native writing file tree ordered by filesystem path instead of custom catalog order', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const treeSource = readFileSync(new URL('../../workspace/WorkspaceFileTree.tsx', import.meta.url), 'utf-8')
    const modelSource = readFileSync(new URL('../../workspace/workspace-file-tree-model.ts', import.meta.url), 'utf-8')

    expect(appShellSource).not.toContain('NovelWorkspaceCatalogOrder')
    expect(appShellSource).not.toContain('novelWorkspaceCatalogOrder')
    expect(appShellSource).not.toContain('novelWorkspaceSidebarItemOrders')
    expect(appShellSource).not.toContain('orderSidebarItemsByStoredIds')
    expect(modelSource).toContain('.sort((left, right) => collator.compare(left.name, right.name))')
    expect(treeSource).toContain('dragNodes.every(node => node.parent?.id === parentNode.id)')
    expect(treeSource).not.toContain('onItemsReorder')
    expect(appShellSource).not.toContain("t('writing.catalog.manuscriptFirst', '正文置顶')")
    expect(appShellSource).not.toContain("t('writing.catalog.globalFirst', '全局信息置顶')")
  })

  it('exposes folder and file operations through Finder-style context menus', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const treeSource = readFileSync(new URL('../../workspace/WorkspaceFileTree.tsx', import.meta.url), 'utf-8')
    const rowSource = readFileSync(new URL('../../workspace/WorkspaceFileTreeRow.tsx', import.meta.url), 'utf-8')
    const moveHandlerSource = appShellSource.slice(
      appShellSource.indexOf('const handleMoveNovelWorkspaceEntry = React.useCallback'),
      appShellSource.indexOf('const handleRenameNovelWorkspaceEntry = React.useCallback'),
    )

    expect(appShellSource).toContain('const handleMoveNovelWorkspaceEntry = React.useCallback')
    expect(appShellSource).toContain('window.electronAPI.moveWorkspaceEntry({')
    expect(moveHandlerSource).toContain('invalidateNovelWorkspaceCatalogRequests(novelWorkspaceRoot)')
    expect(moveHandlerSource).not.toContain('refreshNovelWorkspaceFiles')
    expect(appShellSource).toContain('const handleDeleteNovelWorkspaceEntry = React.useCallback')
    expect(appShellSource).toContain('window.electronAPI.deleteWorkspaceEntry({')
    expect(appShellSource).toContain('recursive: entry.type ===')
    expect(appShellSource).toContain('novelWorkspaceCatalogCacheRef.current.delete(novelWorkspaceRoot)')
    expect(appShellSource).toContain('...createActions(entry.relativePath)')
    expect(appShellSource).toContain("if (entry.type === 'file')")
    expect(appShellSource).not.toContain('getNovelFolderCreateTarget')
    expect(appShellSource).not.toContain('getNovelFileCreateBasePath')
    expect(appShellSource).toContain('revealWorkspaceFile({')
    expect(appShellSource).toContain('showInFolder: path => window.electronAPI.showInFolder(path)')
    expect(appShellSource).toContain("t('sessionMenu.showInFileManager', { fileManager: fileManagerName })")
    expect(treeSource).toContain('onMove={handleMove}')
    expect(treeSource).toContain('onRename={handleRename}')
    expect(treeSource).toContain('disableMultiSelection')
    expect(rowSource).toContain('onSelect={() => void node.edit()}')
    expect(rowSource).toContain('onSelect={() => context.onDelete(entry)}')
    expect(rowSource).toContain('<ContextMenuTrigger asChild>{row}</ContextMenuTrigger>')
  })

  it('prevents pre-mutation catalog requests from republishing stale tree state', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const refreshSource = appShellSource.slice(
      appShellSource.indexOf('const refreshNovelWorkspaceFiles = React.useCallback'),
      appShellSource.indexOf('const openWorkspaceCreateEntryDialog = React.useCallback'),
    )
    const deleteSource = appShellSource.slice(
      appShellSource.indexOf('const handleDeleteNovelWorkspaceEntry = React.useCallback'),
      appShellSource.indexOf('const refreshNovelVersions = React.useCallback'),
    )

    expect(appShellSource).toContain('advanceWorkspaceCatalogRevision(')
    expect(appShellSource).toContain('const refreshNovelWorkspaceFilesAfterMutation = React.useCallback')
    expect(refreshSource).toContain('const requestRevision = readWorkspaceCatalogRevision(')
    expect(refreshSource).toContain('!== requestRevision')
    expect(appShellSource).toContain('const detectionRevision = readWorkspaceCatalogRevision(')
    expect(appShellSource).toContain('!== detectionRevision')
    expect(deleteSource).toContain('invalidateNovelWorkspaceCatalogRequests(novelWorkspaceRoot)')
  })

  it('uses current novel project history instead of global release notes in novel utility navigation', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const novelKeyboardItemsSource = appShellSource.slice(
      appShellSource.indexOf('const unifiedSidebarItems'),
      appShellSource.indexOf('// Toggle folder expanded state')
    )
    const novelWorkspaceActionsSource = appShellSource.slice(
      appShellSource.indexOf('workspaceActions={('),
      appShellSource.indexOf('<WorkspaceEmptyState', appShellSource.indexOf('workspaceActions={('))
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
    const modelSource = readFileSync(new URL('../../workspace/workspace-file-tree-model.ts', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('<WorkspaceProjectSidebar')
    expect(appShellSource).toContain('workspaceName: activeWorkspace?.name')
    expect(appShellSource).toContain('directories: novelWorkspaceDirectories')
    expect(modelSource).toContain('buildWorkspaceFileTree')
    expect(modelSource).not.toContain('globalSectionDefinitions')
    expect(modelSource).not.toContain('NOVEL_WORKSPACE_GLOBAL_GROUP_ID')
    expect(modelSource).not.toContain('formatNovelWorkspaceFileTitle')
  })

  it('exports explicitly selected project files without category inference', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const exportDialogSource = readFileSync(new URL('../../workspace/ProjectExportDialog.tsx', import.meta.url), 'utf-8')
    const versionDialogSource = readFileSync(new URL('../NovelVersionHistoryDialog.tsx', import.meta.url), 'utf-8')
    const topBarSource = readFileSync(new URL('../../app-shell/TopBar.tsx', import.meta.url), 'utf-8')
    const editorPanelSource = readFileSync(new URL('../NovelDocumentEditorPanel.tsx', import.meta.url), 'utf-8')
    const exportHandlerSource = appShellSource.slice(
      appShellSource.indexOf('const handleExportNovelWorkspace'),
      appShellSource.indexOf('const novelReviewUndoStackRef')
    )
    const restoreHandlerSource = appShellSource.slice(
      appShellSource.indexOf('const handleRestoreNovelVersion'),
      appShellSource.indexOf('const handleExportNovelWorkspace')
    )
    const exportDialogShellSource = exportDialogSource.slice(
      exportDialogSource.indexOf('export function ProjectExportDialog'),
      exportDialogSource.indexOf('function ProjectExportDialogContent')
    )
    const versionDialogShellSource = versionDialogSource.slice(
      versionDialogSource.indexOf('export function NovelVersionHistoryDialog'),
      versionDialogSource.indexOf('function NovelVersionHistoryDialogContent')
    )

    expect(appShellSource).toContain('ProjectExportDialog')
    expect(appShellSource).toContain('NovelVersionHistoryDialog')
    expect(appShellSource).toContain('handleExportNovelWorkspace')
    expect(appShellSource).toContain('handleCreateNovelVersion')
    expect(appShellSource).toContain('handleRestoreNovelVersion')
    expect(appShellSource).toContain('setNovelExportDialogOpen(true)')
    expect(appShellSource).toContain('setNovelVersionDialogOpen(true)')
    expect(appShellSource).toContain('workspaceActions={(')
    expect(appShellSource).toContain('buildProjectExportPlan')
    expect(appShellSource).not.toContain('buildMergedManuscriptContent')
    expect(appShellSource).toContain('NOVEL_AUTO_VERSION_CHAR_THRESHOLD = 100')
    expect(appShellSource).toContain('NOVEL_AUTO_VERSION_INTERVAL_MS = 5 * 60 * 1000')
    expect(appShellSource).toContain('novelAutoVersionTimerRef')
    expect(appShellSource).toContain("window.electronAPI.createWorkspaceVersion(novelWorkspaceRoot, { reason: 'auto' })")
    expect(appShellSource).toContain('window.electronAPI.listWorkspaceVersions(novelWorkspaceRoot, 30)')
    expect(appShellSource).toContain('window.electronAPI.restoreWorkspaceVersion(novelWorkspaceRoot, commitHash)')
    expect(restoreHandlerSource).toContain('await refreshNovelWorkspaceFilesAfterMutation(novelWorkspaceRoot)')
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
    expect(exportDialogSource).toContain('getProjectExportDirectories')
    expect(exportDialogSource).toContain('selectedFilePaths')
    expect(exportDialogSource).toContain('function ProjectExportDialogContent')
    expect(exportDialogShellSource).not.toContain('buildNovelWorkspaceTree')
    expect(exportDialogSource).not.toContain('summarizeNovelSection')
    expect(exportDialogSource).not.toContain('mergeManuscript')
    expect(exportDialogSource).not.toContain('NOVEL_EXPORT_SECTIONS')
    expect(exportDialogSource).toContain("t('writing.export.title', '导出项目')")
    expect(exportDialogSource).toContain("t('writing.export.action', '导出')")
    expect(exportDialogSource).toContain("onExport({ selectedPaths: selectedFilePaths })")
    expect(versionDialogSource).toContain("t('writing.version.title', '版本管理')")
    expect(versionDialogSource).toContain('function NovelVersionHistoryDialogContent')
    expect(versionDialogShellSource).not.toContain('versions.map')
    expect(versionDialogSource).toContain('onCreateVersion')
    expect(versionDialogSource).toContain('onRestore(version.hash)')
    expect(appShellSource).toContain("t('writing.export.action', '导出')")
  })

  it('auto-saves before file switching and selection Ask AI when the current document has unsaved edits', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const treeSource = readFileSync(new URL('../../workspace/WorkspaceFileTree.tsx', import.meta.url), 'utf-8')
    const askAiSource = appShellSource.slice(
      appShellSource.indexOf('const handleAskAiForNovelSelection'),
      appShellSource.indexOf('const navigatorPanelWidth')
    )

    expect(appShellSource).toContain('handleSelectNovelFile')
    expect(appShellSource).toContain('ensureNovelDocumentSaved')
    expect(appShellSource).toContain('window.setTimeout')
    expect(appShellSource).toContain('window.clearTimeout')
    expect(treeSource).toContain('onSelectFile({ path: node.data.path, relativePath: node.data.relativePath })')
    expect(treeSource).not.toContain('setSelectedNovelFilePath')
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
    const changeSource = appShellSource.slice(
      appShellSource.indexOf('const handleNovelDocumentChanged ='),
      appShellSource.indexOf('const getCurrentNovelDocumentContent')
    )
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
    // Reuse editor across chapter switches; setContent replaces document content.
    expect(editorPanelSource).not.toContain('key={file.path}')
    expect(editorPanelSource).toContain('onDocumentChanged={onDocumentChanged}')
    expect(editorPanelSource).not.toContain('onUpdate={onChange}')
    expect(appShellSource).toContain('novelDocumentEditorRef')
    expect(appShellSource).toContain('handleNovelDocumentChanged')
    expect(appShellSource).toContain('novelDocumentChangeVersionFlushRef')
    expect(appShellSource).toContain('getCurrentNovelDocumentContent')
    expect(changeSource).toContain('novelDocumentChangeVersionRef.current += 1')
    expect(changeSource).toContain('window.setTimeout')
    expect(changeSource).not.toContain('setNovelDocumentChangeVersion((version)')
    expect(autosaveSource).toContain('const contentToSave = getCurrentNovelDocumentContent()')
    expect(ensureSaveSource).toContain('const versionToSave = novelDocumentChangeVersionRef.current')
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
    const treeSource = readFileSync(new URL('../../workspace/WorkspaceFileTree.tsx', import.meta.url), 'utf-8')
    const rowSource = readFileSync(new URL('../../workspace/WorkspaceFileTreeRow.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('dismissedNovelReviewDotKeys')
    expect(appShellSource).toContain('pendingNovelReviewDotKeysByPath')
    expect(appShellSource).toContain('handleDismissNovelReviewDot')
    expect(appShellSource).toContain('hasReviewDot: hasNovelReviewDot')
    expect(appShellSource).toContain('onDismissReviewDot: handleDismissNovelReviewDot')
    expect(treeSource).toContain('hasReviewDot?: (path: string) => boolean')
    expect(rowSource).toContain('context.hasReviewDot?.(entry.path)')
    expect(rowSource).toContain('context.onDismissReviewDot?.(entry.path)')
    expect(rowSource).toContain('bg-emerald-500')
  })

  it('removes the obsolete categorized changes navigator', () => {
    const navigatorSource = readSourceIfExists(new URL('../NovelWorkspaceNavigatorPanel.tsx', import.meta.url))

    expect(navigatorSource).toBe('')
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
    expect(reviewControllerSource).toContain('const nextPendingPathSet = new Set(nextPendingPaths)')
    expect(reviewControllerSource).toContain('nextPendingPathSet.has(path)')
    expect(reviewControllerSource).not.toContain('nextPendingPaths.includes(path)')
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

  it('merges the novel catalog into the single workspace sidebar while utility views use the navigator column', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const navigatorSlotSource = appShellSource.slice(
      appShellSource.indexOf('navigatorSlot={'),
      appShellSource.indexOf('navigatorWidth=')
    )
    // The manuscript owns its own column, so its states live in the document
    // surface rather than competing with the conversation list for one slot.
    const documentSurfaceSource = appShellSource.slice(
      appShellSource.indexOf('const writingDocumentSurface ='),
      appShellSource.indexOf('navigatorSlot={')
    )

    expect(appShellSource).toContain('const showNovelWorkspaceSidebar = novelWorkspaceRootMatchesCandidates')
    expect(appShellSource).toContain('const showWritingWorkspaceShell = isProjectRuntime')
    expect(appShellSource).toContain('&& (isWritingNavigation(navState) || isSessionsNavigation(navState))')
    expect(appShellSource).toContain('const showNovelDocumentNavigator = showWritingDocumentSurface && showNovelWorkspaceSidebar')
    expect(appShellSource).toContain('const hasUnsettledNovelWorkspaceCandidates = novelWorkspaceCandidateRoots.length > 0 && novelWorkspaceDetectionSettledKey !== novelWorkspaceCandidateKey')
    expect(appShellSource).toContain('const showNovelWorkspacePending = showWritingDocumentSurface && (')
    expect(appShellSource).toContain('const showNovelWorkspaceUnavailable = showWritingDocumentSurface')
    expect(appShellSource).toContain('setNovelWorkspaceDetecting(shouldKeepWorkspaceChromeWhileDetecting)')
    expect(appShellSource).toContain('const navigatorPanelWidth = sessionListWidth')
    expect(appShellSource).toContain("t('writing.loadingWorkspace'")
    expect(documentSurfaceSource).toContain(') : showNovelWorkspacePending ? (')
    expect(documentSurfaceSource).toContain(') : showNovelWorkspaceUnavailable ? (')
    expect(navigatorSlotSource).toContain('<SessionList')
    expect(navigatorSlotSource).not.toContain('showNovelWorkspacePending')
    expect(appShellSource).not.toContain('NovelWorkspaceUtilityTopNav')
    expect(appShellSource).not.toContain('workspaceTools={showNovelWorkspaceSidebar ? (')
    expect(appShellSource).toContain('showNovelDocumentNavigator && novelWorkspaceRoot ? (')
  })

  it('does not derive writing workspace roots from a stale session outside the active workspace', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const workingDirectorySource = appShellSource.slice(
      appShellSource.indexOf('const rawEffectiveSessionId ='),
      appShellSource.indexOf('const latestNovelFileChanges')
    )

    expect(workingDirectorySource).toContain('useAtomValue(sessionMetaAtomFamily(rawEffectiveSessionId')
    expect(workingDirectorySource).toContain('rawEffectiveSessionMeta?.workspaceId === activeWorkspaceId')
    expect(workingDirectorySource).toContain('rawEffectiveSessionMeta?.workspaceId === remoteWorkspaceId')
    expect(workingDirectorySource).toContain('? rawEffectiveSessionMeta?.workingDirectory')
    expect(workingDirectorySource).not.toContain('sessionMetaMap.get(effectiveSessionId)')
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
    expect(effectiveSessionSource).toContain('const rawEffectiveSessionMeta = useAtomValue(sessionMetaAtomFamily(rawEffectiveSessionId')
    expect(effectiveSessionSource).toContain('rawEffectiveSessionMeta?.workspaceId === activeWorkspaceId')
    expect(effectiveSessionSource).toContain('rawEffectiveSessionMeta?.workspaceId === remoteWorkspaceId')
    expect(effectiveSessionSource).toContain('const effectiveSessionId = rawEffectiveSessionBelongsToWorkspace ? rawEffectiveSessionId : null')
  })

  it('does not render stale chat panel routes from another workspace during workspace switches', () => {
    const mainContentSource = readFileSync(new URL('../../app-shell/MainContentPanel.tsx', import.meta.url), 'utf-8')
    const sessionsContentSource = mainContentSource.slice(
      mainContentSource.indexOf('// Session routes reuse the same chat surface'),
      mainContentSource.indexOf('// Fallback (should not happen with proper NavigationState)')
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
      sessionRouteContentSource.indexOf('<LazyChatPage sessionId={sessionId} />')
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

    expect(appShellSource).toContain('novelWorkspaceCatalogCacheRef.current.set(rootPath, catalog)')
    expect(detectionSource).toContain('const cachedNovelWorkspaceCatalog = novelWorkspaceCatalogCacheRef.current.get(rootPath)')
    const cachedCatalogBranch = detectionSource.slice(
      detectionSource.indexOf('if (cachedNovelWorkspaceCatalog)'),
      detectionSource.indexOf('try {')
    )
    expect(cachedCatalogBranch).toContain('setNovelWorkspaceCatalogIfChanged(cachedNovelWorkspaceCatalog)')
    expect(cachedCatalogBranch).toContain('return')
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

    expect(loadSource).toContain('loadNovelWorkspaceFileTree(rootPath)')
    expect(detectionSource).toContain('const knownWritingWorkspaceRoot = rootPath === activeWritingWorkspaceRoot')
    expect(detectionSource).toContain('knownWritingWorkspaceRoot || Boolean(cachedNovelWorkspaceCatalog)')
    expect(detectionSource).not.toContain('NOVEL_WORKSPACE_DETECTION_QUERIES.map')
  })

  it('loads known writing workspace roots through purpose-built file listing', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const fileTreeSource = appShellSource.slice(
      appShellSource.indexOf('async function loadNovelWorkspaceFileTree'),
      appShellSource.indexOf('function getParentRelativePath')
    )
    const loadSource = appShellSource.slice(
      appShellSource.indexOf('const loadNovelWorkspaceFiles ='),
      appShellSource.indexOf('const refreshNovelWorkspaceFiles')
    )
    const refreshSource = appShellSource.slice(
      appShellSource.indexOf('const refreshNovelWorkspaceFiles ='),
      appShellSource.indexOf('const openWorkspaceCreateEntryDialog')
    )
    const detectionSource = appShellSource.slice(
      appShellSource.indexOf('async function detectNovelWorkspace'),
      appShellSource.indexOf('void detectNovelWorkspace()')
    )

    expect(loadSource).toContain('knownNovelWorkspace = false')
    expect(loadSource).toContain('if (knownNovelWorkspace)')
    expect(loadSource).toContain('loadNovelWorkspaceFileTree(rootPath)')
    expect(fileTreeSource).toContain('window.electronAPI.listWorkspaceFiles(rootPath, [])')
    expect(fileTreeSource).not.toContain('searchNovelWorkspaceFiles(rootPath')
    expect(refreshSource).toContain('rootPath === novelWorkspaceRootRef.current || novelWorkspaceCatalogCacheRef.current.has(rootPath)')
    expect(detectionSource).toContain('knownWritingWorkspaceRoot || Boolean(cachedNovelWorkspaceCatalog)')
  })

  it('coalesces writing workspace file loads before refresh state updates', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const loadSource = appShellSource.slice(
      appShellSource.indexOf('const loadNovelWorkspaceFiles ='),
      appShellSource.indexOf('const refreshNovelWorkspaceFiles')
    )
    const refreshSource = appShellSource.slice(
      appShellSource.indexOf('const refreshNovelWorkspaceFiles ='),
      appShellSource.indexOf('const openWorkspaceCreateEntryDialog')
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
    expect(refreshSource).toContain('if (novelWorkspaceRootRef.current && rootPath !== novelWorkspaceRootRef.current) return false')
    expect(appShellSource).toContain('areNovelWorkspaceFilesEqual(previous, catalog.files) ? previous : catalog.files')
  })

  it('rechecks completed file-change refresh keys inside delayed refresh callbacks', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const effectStart = appShellSource.indexOf('const sessionWasProcessing = effectiveSessionId')
    const delayedRefreshSource = appShellSource.slice(
      appShellSource.indexOf('const timeoutId = window.setTimeout(() => {', effectStart),
      appShellSource.indexOf('}, 250)', effectStart)
    )

    expect(delayedRefreshSource).toContain('window.setTimeout(() => {\n      if (completedNovelFileChangeRefreshKeys.has(refreshKey)) return')
  })

  it('marks checkpoint-driven writing workspace refreshes as covered before delayed refresh', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const checkpointSource = appShellSource.slice(
      appShellSource.indexOf('const checkpointNovelWorkspaceAgentTurn ='),
      appShellSource.indexOf('React.useEffect(() => {\n    if (!effectiveSessionId || !novelWorkspaceRoot) return')
    )

    expect(checkpointSource).toContain('refreshNovelWorkspaceFilesAfterMutation(novelWorkspaceRoot).then((refreshed) => {')
    expect(checkpointSource).toContain('if (refreshed) markNovelWorkspaceFileChangesCovered(novelWorkspaceRoot)')
  })

  it('uses equality guarded writing workspace file updates during detection', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const detectionSource = appShellSource.slice(
      appShellSource.indexOf('async function detectNovelWorkspace'),
      appShellSource.indexOf('void detectNovelWorkspace()')
    )

    expect(appShellSource).toContain('const setNovelWorkspaceCatalogIfChanged = React.useCallback')
    expect(detectionSource).toContain('setNovelWorkspaceCatalogIfChanged(cachedNovelWorkspaceCatalog)')
    expect(detectionSource).toContain('setNovelWorkspaceCatalogIfChanged({ files: probeFiles, directories: [] })')
    expect(detectionSource).toContain('setNovelWorkspaceCatalogIfChanged(catalog)')
  })

  it('preserves the selected writing file when catalog refreshes temporarily omit it', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const selectionSource = appShellSource.slice(
      appShellSource.indexOf('const selectedNovelFile = React.useMemo'),
      appShellSource.indexOf('const [novelDocumentContent')
    )

    expect(selectionSource).toContain('if (!selectedNovelFilePath) return defaultNovelFile')
    expect(selectionSource).toContain('const listedFile = novelWorkspaceFileByPath.get(selectedNovelFilePath)')
    expect(selectionSource).not.toContain('novelWorkspaceFiles.find(file => file.path === selectedNovelFilePath)')
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

  it('reuses writing file path lookup when selecting files by path', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const selectByPathSource = appShellSource.slice(
      appShellSource.indexOf('const handleSelectNovelFileByPath = React.useCallback'),
      appShellSource.indexOf('const prepareNovelWorkspaceBriefForSend')
    )

    expect(appShellSource).toContain('const novelWorkspaceFileByPath = React.useMemo(')
    expect(selectByPathSource).toContain('const file = novelWorkspaceFileByPath.get(filePath)')
    expect(selectByPathSource).not.toContain('novelWorkspaceFiles.find(item => item.path === filePath)')
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
    expect(visibilitySource).toContain('const showNovelWorkspacePending = showWritingDocumentSurface && (')
    expect(visibilitySource).toContain('const showNovelWorkspaceUnavailable = showWritingDocumentSurface')
    expect(visibilitySource).toContain('hasStaleNovelWorkspaceRoot')
    expect(visibilitySource).toContain('(!showNovelWorkspaceSidebar && hasUnsettledNovelWorkspaceCandidates)')
  })

  it('does not render the legacy session navigator on cold start before writing workspace detection settles', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const visibilitySource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceCandidateKey ='),
      appShellSource.indexOf('const reviewableNovelFileChanges')
    )
    const documentSurfaceSource = appShellSource.slice(
      appShellSource.indexOf('const writingDocumentSurface ='),
      appShellSource.indexOf('navigatorSlot={')
    )

    expect(visibilitySource).toContain('const hasUnsettledNovelWorkspaceCandidates = novelWorkspaceCandidateRoots.length > 0 && novelWorkspaceDetectionSettledKey !== novelWorkspaceCandidateKey')
    expect(visibilitySource).toContain('(!showNovelWorkspaceSidebar && hasUnsettledNovelWorkspaceCandidates)')
    expect(documentSurfaceSource).toContain('showNovelWorkspacePending')
  })

  it('does not render the legacy session navigator after writing workspace detection misses', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const visibilitySource = appShellSource.slice(
      appShellSource.indexOf('const novelWorkspaceCandidateRootSet ='),
      appShellSource.indexOf('const reviewableNovelFileChanges')
    )
    const navigatorSlotSource = appShellSource.slice(
      appShellSource.indexOf('navigatorSlot={'),
      appShellSource.indexOf('navigatorWidth=')
    )
    // The manuscript states live in their own column now, so the detection-miss
    // notice belongs to the document surface rather than the navigator.
    const documentSurfaceSource = appShellSource.slice(
      appShellSource.indexOf('const writingDocumentSurface ='),
      appShellSource.indexOf('navigatorSlot={')
    )

    expect(visibilitySource).toContain('activeWritingWorkspaceRoot !== null')
    expect(visibilitySource).toContain('&& !showNovelWorkspaceSidebar')
    expect(visibilitySource).toContain('&& !showNovelWorkspacePending')
    expect(navigatorSlotSource).toContain('<SessionList')
    expect(navigatorSlotSource).not.toContain('showNovelWorkspaceUnavailable')
    expect(documentSurfaceSource).toContain(') : showNovelWorkspaceUnavailable ? (')
  })

  it('uses generic project-tree defaults without overriding a persisted collapse', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('storage.get<string[] | null>(storage.KEYS.expandedFolders, null, activeWorkspaceId)')
    expect(appShellSource).toContain('getDefaultWritingExpandedIds')
    expect(appShellSource).toContain('persistedExpandedFolders ?? (activeWorkspaceId ? getDefaultWritingExpandedIds(activeWorkspaceId) : [])')
  })

  it('exposes global search from the activity rail backed by the global search dialog', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const activityRailSource = readFileSync(new URL('../../app-shell/ActivityRail.tsx', import.meta.url), 'utf-8')
    const globalSearchSource = readFileSync(new URL('../../app-shell/GlobalSearchDialog.tsx', import.meta.url), 'utf-8')

    expect(activityRailSource).toContain('label="搜索"')
    expect(activityRailSource).toContain('<Search className="h-4 w-4" />')
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
    expect(appShellSource).toContain('const showActivityRail = true')
    expect(activityRailSource).toContain('label="搜索"')
  })

  it('left-aligns sidebar item content instead of letting writing catalog labels drift toward the center', () => {
    const rowSource = readFileSync(new URL('../../workspace/WorkspaceFileTreeRow.tsx', import.meta.url), 'utf-8')

    expect(rowSource).toContain('group flex h-full min-w-0 items-center')
    expect(rowSource).toContain('min-w-0 flex-1 truncate text-left')
    expect(rowSource).toContain('{entry.name}</span>')
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
    expect(appShellSource).toContain('const visibleSessionListWidth = hideSessionListNavigator ? 0 : sessionListWidth')
    expect(appShellSource).toContain('shellWidth - activityRailOffset - visibleSessionListWidth - WRITING_ASSISTANT_MIN_WIDTH')
  })

  it('keeps novel navigator width separate from the regular session list width', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')
    const localStorageSource = readFileSync(new URL('../../../lib/local-storage.ts', import.meta.url), 'utf-8')

    expect(localStorageSource).toContain('novelWorkspaceNavigatorWidth')
    expect(appShellSource).toContain('const [novelWorkspaceNavigatorWidth, setNovelWorkspaceNavigatorWidth]')
    expect(appShellSource).toContain('latestNovelWorkspaceNavigatorWidthRef')
    expect(appShellSource).toContain('setNovelWorkspaceNavigatorWidth(newWidth)')
    expect(appShellSource).toContain('storage.KEYS.novelWorkspaceNavigatorWidth')
    expect(appShellSource).toContain('setNovelWorkspaceNavigatorWidth(nextWidth)')
    // The manuscript column's width now flows through the shared ResizableColumn.
    expect(appShellSource).toContain('width={novelWorkspaceNavigatorWidth}')
    expect(appShellSource).toContain('const navigatorPanelWidth = sessionListWidth')
  })

  it('starts navigator resizing synchronously from the separator handle', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).toContain('beginResize')
    // The manuscript sash lives in ResizableColumn and forwards beginResize via
    // onResizeStart; the session-list sash still calls it inline.
    expect(appShellSource).toContain('onResizeStart={beginResize}')
    expect(appShellSource).toContain("beginResize('session-list', e)")
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
    expect(appShellSource).toContain('width: PANEL_SASH_HIT_WIDTH')
    expect(appShellSource).not.toContain('NAVIGATOR_SASH_HIT_WIDTH')
    expect(appShellSource).not.toContain('NAVIGATOR_SASH_FLEX_MARGIN')
    expect(appShellSource).not.toContain('relative w-0 h-full cursor-col-resize')
    expect(appShellSource).not.toContain('/* Navigator Resize Handle (absolute, hidden in focused mode) */')
  })

  it('starts navigator resizing only from the real separator instead of a shell capture zone', () => {
    const appShellSource = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf-8')

    expect(appShellSource).not.toContain('NAVIGATOR_SASH_CAPTURE_HALF_WIDTH')
    expect(appShellSource).not.toContain('handleNavigatorResizeBoundaryMouseDownCapture')
    expect(appShellSource).not.toContain('onMouseDownCapture={handleNavigatorResizeBoundaryMouseDownCapture}')
    expect(appShellSource).not.toContain('navigatorPanelRect.right + (PANEL_GAP / 2)')
    expect(appShellSource).toContain('onResizeStart={beginResize}')
    expect(appShellSource).toContain("beginResize('session-list', e)")
  })
})
