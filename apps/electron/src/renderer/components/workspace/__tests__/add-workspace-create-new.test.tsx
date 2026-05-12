// input: Workspace creation preview panel props with Method Pack file contracts
// output: Regression coverage for rendering scaffold contracts in the new-workspace flow
// pos: Ensures file-level Method Pack contracts are visible before a workspace is created

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CLAUDE_BOOK_METHOD_PACK } from '@craft-agent/shared/writing/method-packs'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import { initReactI18next } from 'react-i18next'
import { getWorkspaceCreationMethodOption } from '../workspace-method-options'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('beautiful-mermaid', () => ({
  renderMermaidSVG: () => '<svg width="320" height="180"><text>mock mermaid</text></svg>',
}))

setupI18n([initReactI18next])

let MethodPackPreviewPanel: typeof import('../AddWorkspaceStep_CreateNew').MethodPackPreviewPanel

beforeAll(async () => {
  const module = await import('../AddWorkspaceStep_CreateNew')
  MethodPackPreviewPanel = module.MethodPackPreviewPanel
})

describe('AddWorkspaceStep_CreateNew preview panel', () => {
  it('renders the selected Method Pack file contract', () => {
    const option = getWorkspaceCreationMethodOption('novel.claude-book')
    const html = renderToStaticMarkup(
      <MethodPackPreviewPanel
        title={option.fallbackTitle}
        description={option.fallbackPreviewDescription}
        preview={option.richPreview}
        mermaidCode={option.fallbackPreviewMermaid}
        fileContract={option.fileContract}
        labels={{
          logic: 'Method logic',
          workflow: 'Workflow map',
          structure: 'Structure',
          assets: 'Workspace assets',
          fileContract: 'File contract',
          file: 'file',
          directory: 'directory',
          bestFor: 'Best for',
        }}
      />
    )

    expect(html).toContain('File contract')
    expect(html).toContain('mock mermaid')
    expect(html).toContain('craft-writing.json')
    expect(html).toContain('bible/style.md')
    expect(html).toContain('timeline/current-chapter.md')
    expect(html).toContain('directory')
    expect(html).toContain(`${CLAUDE_BOOK_METHOD_PACK.requiredPaths.length}`)
  })
})
