// input: Markdown content and editor selection metadata
// output: Regression coverage for selected text chat context references
// pos: Guards the line-reference contract used by writing editor selection chat actions

import { describe, expect, it } from 'bun:test'
import {
  buildNovelSelectionContext,
  formatNovelSelectionChatMessage,
  formatNovelSelectionContextForChat,
  locateUniqueSelectionLineRange,
} from '../selection-context'

describe('locateUniqueSelectionLineRange', () => {
  it('returns a single-line range for a unique selection', () => {
    expect(locateUniqueSelectionLineRange('alpha\nbeta\ngamma', 'beta')).toEqual({
      startLine: 2,
      endLine: 2,
    })
  })

  it('returns a multi-line range for a unique selection', () => {
    expect(locateUniqueSelectionLineRange('alpha\nbeta\ngamma\ndelta', 'beta\ngamma')).toEqual({
      startLine: 2,
      endLine: 3,
    })
  })

  it('returns null when the selected text is repeated', () => {
    expect(locateUniqueSelectionLineRange('alpha\nbeta\nbeta', 'beta')).toBeNull()
  })
})

describe('formatNovelSelectionContextForChat', () => {
  it('renders a Cursor-style file and line quote block', () => {
    const context = buildNovelSelectionContext({
      content: '第一段\n第二段\n第三段',
      selectedText: '第二段',
      filePath: '/novel/正文/01.md',
      relativePath: '正文/01.md',
    })

    expect(formatNovelSelectionContextForChat(context)).toBe([
      '[正文/01.md:2]',
      '> 第二段',
    ].join('\n'))
  })

  it('falls back to a file-only quote when line lookup is ambiguous', () => {
    const context = buildNovelSelectionContext({
      content: '重复\n唯一\n重复',
      selectedText: '重复',
      filePath: '/novel/正文/01.md',
      relativePath: '正文/01.md',
    })

    expect(formatNovelSelectionContextForChat(context)).toBe([
      '[正文/01.md]',
      '> 重复',
    ].join('\n'))
  })
})

describe('formatNovelSelectionChatMessage', () => {
  it('appends the user instruction after the source quote', () => {
    const context = buildNovelSelectionContext({
      content: '第一段\n第二段\n第三段',
      selectedText: '第二段',
      filePath: '/novel/正文/01.md',
      relativePath: '正文/01.md',
    })

    expect(formatNovelSelectionChatMessage(context, '请改得更克制')).toBe([
      '[正文/01.md:2]',
      '> 第二段',
      '',
      '请改得更克制',
    ].join('\n'))
  })
})
