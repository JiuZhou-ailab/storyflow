// input: display-format helpers
// output: Contract tests for path shortening and relative timestamps
// pos: Guards shared project-list display utilities

import { describe, expect, it } from 'bun:test'
import { formatRelativeTimestamp, shortenDisplayPath } from '../display-format'

describe('shortenDisplayPath', () => {
  it('keeps short paths intact', () => {
    expect(shortenDisplayPath('/a/b', 2)).toBe('/a/b')
    expect(shortenDisplayPath('a/b', 2)).toBe('a/b')
  })

  it('ellipsis long tails', () => {
    expect(shortenDisplayPath('/Users/me/novels/dawn/chapters', 2)).toBe('…/dawn/chapters')
    expect(shortenDisplayPath('/Users/me/novels/dawn', 3)).toBe('…/me/novels/dawn')
  })
})

describe('formatRelativeTimestamp', () => {
  it('returns empty label for missing values', () => {
    expect(formatRelativeTimestamp(undefined)).toBe('未打开过')
  })

  it('labels recent timestamps', () => {
    expect(formatRelativeTimestamp(Date.now() - 10_000)).toBe('刚刚')
    expect(formatRelativeTimestamp(Date.now() - 5 * 60_000)).toBe('5 分钟前')
  })
})
