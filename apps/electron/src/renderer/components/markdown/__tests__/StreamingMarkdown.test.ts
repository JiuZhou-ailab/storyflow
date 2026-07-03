// input: StreamingMarkdown source
// output: Regression checks for streaming markdown hot-path key generation
// pos: Guards streaming assistant rendering against per-chunk completed-block hashing

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const streamingMarkdownSource = readFileSync(new URL('../StreamingMarkdown.tsx', import.meta.url), 'utf-8')

describe('StreamingMarkdown performance contracts', () => {
  it('keys completed blocks by position without hashing block content on every chunk', () => {
    expect(streamingMarkdownSource).not.toContain('function simpleHash')
    expect(streamingMarkdownSource).not.toContain('simpleHash(block.content)')
    expect(streamingMarkdownSource).toContain('`block-${i}`')
    expect(streamingMarkdownSource).toContain('`active-${i}`')
  })
})
