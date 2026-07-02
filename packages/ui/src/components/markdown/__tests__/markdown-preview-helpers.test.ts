import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { normalizePreviewItems, parseMarkdownPreviewSpec } from '../markdown-preview-helpers'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let markdownExports: typeof import('../index')

beforeAll(async () => {
  markdownExports = await import('../index')
})

describe('parseMarkdownPreviewSpec', () => {
  it('parses a single markdown preview source', () => {
    expect(parseMarkdownPreviewSpec(JSON.stringify({ src: '/tmp/a.md', title: 'Draft' }))).toEqual({
      src: '/tmp/a.md',
      title: 'Draft',
    })
  })

  it('filters invalid items and rejects an empty result', () => {
    expect(parseMarkdownPreviewSpec(JSON.stringify({ items: [{ src: '/tmp/a.md' }, { src: '' }] }))).toEqual({
      src: undefined,
      title: undefined,
      items: [{ src: '/tmp/a.md' }],
    })
    expect(parseMarkdownPreviewSpec(JSON.stringify({ items: [{ label: 'missing src' }] }))).toBeNull()
  })
})

describe('normalizePreviewItems', () => {
  it('wraps a single src and lets items win when present', () => {
    expect(normalizePreviewItems({ src: '/tmp/a.md' })).toEqual([{ src: '/tmp/a.md' }])
    expect(normalizePreviewItems({ src: '/tmp/a.md', items: [{ src: '/tmp/b.md' }] })).toEqual([
      { src: '/tmp/b.md' },
    ])
  })
})

describe('markdown preview public exports', () => {
  it('exports the parser through the markdown barrel', () => {
    expect(markdownExports.parseMarkdownPreviewSpec(JSON.stringify({ src: '/tmp/a.md' }))).toEqual({
      src: '/tmp/a.md',
      title: undefined,
    })
  })
})
