// input: Workspace creation preview panel props with Method Pack workflow summaries
// output: Regression coverage for the compact Method Pack preview surface
// pos: Ensures the new-workspace preview emphasizes workflow diagrams over secondary contract lists

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
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
  it('omits structure and file contract explanations from the default preview', () => {
    const option = getWorkspaceCreationMethodOption('novel.claude-book')
    const html = renderToStaticMarkup(
      <MethodPackPreviewPanel
        title={option.fallbackTitle}
        description={option.fallbackPreviewDescription}
        preview={option.richPreview}
        mermaidCode={option.fallbackPreviewMermaid}
        labels={{
          logic: 'Method logic',
          workflow: 'Workflow map',
          assets: 'Workspace assets',
          bestFor: 'Best for',
        }}
      />
    )

    expect(html).toContain('mock mermaid')
    expect(html).not.toContain('Structure')
    expect(html).not.toContain('File contract')
    expect(html).not.toContain('craft-writing.json')
    expect(html).not.toContain('bible/style.md')
    expect(html).not.toContain('timeline/current-chapter.md')
  })
})
