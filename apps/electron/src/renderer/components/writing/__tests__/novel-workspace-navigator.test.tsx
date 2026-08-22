// input: Novel document tabs, editor content, and review changes
// output: SSR regression coverage for the visible tab and editable manuscript surfaces
// pos: Verifies user-visible writing behavior without asserting implementation source text

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import { I18nextProvider, initReactI18next } from 'react-i18next'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const testI18n = setupI18n([initReactI18next]).cloneInstance({
  lng: 'en',
})

let NovelDocumentEditorPanel: typeof import('../NovelDocumentEditorPanel').NovelDocumentEditorPanel
let NovelDocumentTabStrip: typeof import('../NovelDocumentTabStrip').NovelDocumentTabStrip
let countMarkdownTextCharacters: typeof import('../NovelDocumentEditorPanel').countMarkdownTextCharacters

function renderLocalized(node: React.ReactNode): string {
  return renderToStaticMarkup(<I18nextProvider i18n={testI18n}>{node}</I18nextProvider>)
}

beforeAll(async () => {
  const editorModule = await import('../NovelDocumentEditorPanel')
  const tabStripModule = await import('../NovelDocumentTabStrip')
  NovelDocumentEditorPanel = editorModule.NovelDocumentEditorPanel
  NovelDocumentTabStrip = tabStripModule.NovelDocumentTabStrip
  countMarkdownTextCharacters = editorModule.countMarkdownTextCharacters
})

describe('novel writing workspace layout', () => {
  it('renders multiple closable files in one shared accessible tab header', () => {
    const html = renderLocalized(
      <NovelDocumentTabStrip
        files={[
          { path: '/novel/a.md', relativePath: 'a.md' },
          { path: '/novel/b.md', relativePath: 'b.md' },
        ]}
        activePath="/novel/b.md"
        onActivate={() => {}}
        onClose={() => {}}
        onOpenStart={() => {}}
        trailingActions={<button type="button">目录</button>}
      />
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('a.md')
    expect(html).toContain('b.md')
    expect(html).toMatch(/aria-label="[^"]+" title="[^"]+"/)
    expect(html).toContain('目录')
  })

  it('renders the selected Markdown document in a single editable writing surface', () => {
    const html = renderLocalized(
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
    const html = renderLocalized(
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
    const html = renderLocalized(
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
    const html = renderLocalized(
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
    const html = renderLocalized(
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
    const html = renderLocalized(
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
    const html = renderLocalized(
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
})
