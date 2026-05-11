// input: Previous controlled content, incoming content, and current editor markdown
// output: Regression coverage for TipTap content sync decisions
// pos: Keeps focused document switches from losing externally loaded content

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

  it('syncs externally changed content even when it differs from the focused editor markdown', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# Other file',
      currentMarkdown: '# Unsaved local buffer',
    })).toBe('sync')
  })
})
