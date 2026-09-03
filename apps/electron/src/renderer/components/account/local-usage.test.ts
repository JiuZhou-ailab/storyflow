// input: Date strings in the formats @uiw/react-heat-map emits from rectRender
// output: Regression coverage for parseHeatMapDate parsing and null-safety
// pos: Contract test pinning the usage heat-map date parsing against the
//      library's unpadded YYYY/M/D re-serialization.

import { describe, expect, it } from 'bun:test'
import { buildUsageCalendar, isLocalDateKey, parseHeatMapDate } from './local-usage.ts'

describe('parseHeatMapDate', () => {
  it('parses the unpadded YYYY/M/D string @uiw hands back from rectRender', () => {
    const date = parseHeatMapDate('2026/9/3')
    expect(date).not.toBeNull()
    expect(date!.getFullYear()).toBe(2026)
    expect(date!.getMonth()).toBe(8) // 0-indexed September
    expect(date!.getDate()).toBe(3)
  })

  it('parses padded ISO YYYY-MM-DD too (the format we feed into the value prop)', () => {
    const date = parseHeatMapDate('2026-03-05')
    expect(date).not.toBeNull()
    expect(date!.getFullYear()).toBe(2026)
    expect(date!.getMonth()).toBe(2)
    expect(date!.getDate()).toBe(5)
  })

  it('returns null for unparseable values instead of letting the Date constructor throw', () => {
    expect(parseHeatMapDate('')).toBeNull()
    expect(parseHeatMapDate('invalid')).toBeNull()
    expect(parseHeatMapDate('2026-02-31')).toBeNull() // Feb 31 does not exist
    expect(parseHeatMapDate('garbage/13/99')).toBeNull()
    expect(parseHeatMapDate('2026/13/1')).toBeNull() // month 13 does not exist
  })
})

describe('buildUsageCalendar', () => {
  it('emits padded ISO date keys that survive round-trip through parseHeatMapDate', () => {
    const calendar = buildUsageCalendar(
      [{ date: '2026-08-01', inputTokens: 0, outputTokens: 0, totalTokens: 5 }],
      new Date(2026, 8, 3),
    )
    const withUsage = calendar.find(day => day.count > 0)
    expect(withUsage?.date).toBe('2026-08-01')
    // The library re-serializes to YYYY/M/D; parsing that must round-trip.
    expect(parseHeatMapDate('2026/8/1')).not.toBeNull()
  })
})

describe('isLocalDateKey', () => {
  it('rejects non-canonical or impossible date keys', () => {
    expect(isLocalDateKey('2026-08-01')).toBe(true)
    expect(isLocalDateKey('2026/8/1')).toBe(false)
    expect(isLocalDateKey('2026-02-31')).toBe(false)
    expect(isLocalDateKey('not-a-date')).toBe(false)
  })
})
