import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let Markdown: typeof import('../Markdown').Markdown

beforeAll(async () => {
  Markdown = (await import('../Markdown')).Markdown
})

describe('Markdown link href safety', () => {
  it('omits dangerous schemes from DOM href attributes', () => {
    const html = renderToStaticMarkup(<Markdown>{'[bad](javascript:alert(1)) [ok](https://example.com)'}</Markdown>)

    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('href="javascript:')
  })
})
