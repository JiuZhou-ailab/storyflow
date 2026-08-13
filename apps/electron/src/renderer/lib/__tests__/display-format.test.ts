// input: display-format timestamp helper
// output: Contract tests for relative timestamps
// pos: Guards shared project-list display utilities

import { describe, expect, it } from 'bun:test'
import { formatRelativeTimestamp } from '../display-format'

describe('formatRelativeTimestamp', () => {
  it('returns empty label for missing values', () => {
    expect(formatRelativeTimestamp(undefined)).toBe('未打开过')
  })

  it('labels recent timestamps', () => {
    expect(formatRelativeTimestamp(Date.now() - 10_000)).toBe('刚刚')
    expect(formatRelativeTimestamp(Date.now() - 5 * 60_000)).toBe('5 分钟前')
  })
})
