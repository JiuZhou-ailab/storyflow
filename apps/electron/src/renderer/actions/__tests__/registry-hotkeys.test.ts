// input: Synthetic keyboard events and renderer hotkey declarations
// output: Exact modifier matching regression coverage
// pos: Guards global shortcuts from swallowing unrelated key combinations

import { describe, expect, it } from 'bun:test'
import { matchesHotkey } from '../registry'

const ctrlTabEvent = {
  key: 'Tab',
  code: 'Tab',
  metaKey: false,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
} as KeyboardEvent

const ctrlShiftTabEvent = {
  ...ctrlTabEvent,
  shiftKey: true,
} as KeyboardEvent

describe('matchesHotkey', () => {
  it('does not classify Ctrl+Tab as plain Tab on macOS', () => {
    expect(matchesHotkey(ctrlTabEvent, 'tab', true)).toBe(false)
  })

  it('matches a literal Ctrl+Tab binding on macOS', () => {
    expect(matchesHotkey(ctrlTabEvent, 'ctrl+tab', true)).toBe(true)
  })

  it('keeps Ctrl+Shift+Tab separate from Shift+Tab', () => {
    expect(matchesHotkey(ctrlShiftTabEvent, 'shift+tab', true)).toBe(false)
    expect(matchesHotkey(ctrlShiftTabEvent, 'ctrl+shift+tab', true)).toBe(true)
  })
})
