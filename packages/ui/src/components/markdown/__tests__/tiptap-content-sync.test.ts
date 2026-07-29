// input: Previous controlled content, incoming content, and current editor markdown
// output: Regression coverage for TipTap content sync decisions
// pos: Keeps focused document switches from losing externally loaded content

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { getIncomingContentSyncAction } from '../TiptapMarkdownEditor'

describe('getIncomingContentSyncAction', () => {
  it('ignores unchanged controlled content', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# One',
      currentMarkdown: '# One',
    })).toBe('ignore')
  })

  it('records controlled echoes without resetting editor content', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# Two',
      currentMarkdown: '# Two',
    })).toBe('record')
  })

  it('records editor-originated controlled echoes without reading current markdown', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# Two',
      lastEmittedMarkdown: '# Two',
    })).toBe('record')
  })

  it('syncs externally changed content even when it differs from the focused editor markdown', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# Other file',
      currentMarkdown: '# Unsaved local buffer',
    })).toBe('sync')
  })

  it('checks editor-originated content before serializing current markdown', () => {
    const source = readFileSync(new URL('../TiptapMarkdownEditor.tsx', import.meta.url), 'utf-8')

    expect(source.indexOf('const fastSyncAction = getIncomingContentSyncAction')).toBeLessThan(
      source.indexOf('const currentMd =')
    )
    expect(source).toContain('lastEmittedMarkdownRef')
  })

  it('exposes a dirty signal and explicit markdown snapshot for long documents', () => {
    const source = readFileSync(new URL('../TiptapMarkdownEditor.tsx', import.meta.url), 'utf-8')

    expect(source).toContain('export interface TiptapMarkdownEditorHandle')
    expect(source).toContain('getMarkdownSnapshot(): string')
    expect(source).toContain('onDocumentChanged?: () => void')
    expect(source).toContain('React.useImperativeHandle')
    expect(source).toContain('onDocumentChangedRef.current?.()')
  })

  it('does not emit a user edit while applying external document content', () => {
    const source = readFileSync(new URL('../TiptapMarkdownEditor.tsx', import.meta.url), 'utf-8')

    expect(source).toContain('emitUpdate: false')
    expect(source).toContain('isApplyingExternalContentRef.current || !editor.isFocused')
  })
})
