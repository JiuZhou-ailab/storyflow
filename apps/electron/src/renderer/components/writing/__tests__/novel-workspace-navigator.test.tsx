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
        onCreateFile={() => {}}
        trailingActions={<button type="button">目录</button>}
      />
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('a.md')
    expect(html).toContain('b.md')
    expect(html).toContain('data-workspace-action="create-file"')
    expect(html).toContain('aria-label="New file"')
    expect(html).toContain('title="New file"')
    expect(html).not.toContain('Where would you like to start?')
    expect(html).toContain('目录')
  })

  it('hides the new-file control when the surface cannot create files', () => {
    const html = renderLocalized(
      <NovelDocumentTabStrip
        files={[{ path: '/novel/a.md', relativePath: 'a.md' }]}
        activePath="/novel/a.md"
        onActivate={() => {}}
        onClose={() => {}}
      />
    )

    expect(html).toContain('a.md')
    expect(html).not.toContain('data-workspace-action="create-file"')
    expect(html).not.toContain('aria-label="New file"')
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
})
