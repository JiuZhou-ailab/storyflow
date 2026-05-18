// input: Resource edit action props for config-backed entities
// output: Regression coverage for separate manual and AI edit affordances
// pos: Keeps resource edit controls from collapsing manual editing into AI-only flows

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('beautiful-mermaid', () => ({
  renderMermaidSVG: () => '<svg width="320" height="180"><text>mock mermaid</text></svg>',
}))

let ManualEditButton: typeof import('../manual-edit-button').ManualEditButton

beforeAll(async () => {
  const module = await import('../manual-edit-button')
  ManualEditButton = module.ManualEditButton
})

describe('resource edit actions', () => {
  it('renders a direct manual edit button for file-backed resources', () => {
    const html = renderToStaticMarkup(
      <ManualEditButton
        label="Edit File"
        filePath="/workspace/sources/github/config.json"
        onOpenFile={() => {}}
      />
    )

    expect(html).toContain('data-testid="manual-edit-file-button"')
    expect(html).toContain('Edit File')
    expect(html).toContain('title="Edit File"')
  })
})
