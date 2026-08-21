// input: Workspace view configs
// output: Equality guard coverage for view refresh state writes
// pos: Keeps view refreshes from recompiling filters on no-op changes

import { describe, expect, it } from 'bun:test'
import type { ViewConfig } from '../../../shared/views'
import { areViewConfigsEqual } from '../useViews'

const views: ViewConfig[] = [
  {
    id: 'needs-review',
    name: 'Needs Review',
    description: 'Unread plan sessions',
    color: { light: '#111111', dark: '#eeeeee' },
    expression: 'hasUnread == true',
  },
  {
    id: 'expensive',
    name: 'Expensive',
    color: 'info/80',
    expression: 'tokenUsage.costUsd > 1',
  },
]

describe('areViewConfigsEqual', () => {
  it('treats equivalent view configs as equal', () => {
    expect(areViewConfigsEqual(views, structuredClone(views))).toBe(true)
  })

  it('treats order and filter fields as meaningful', () => {
    expect(areViewConfigsEqual(views, [views[1], views[0]])).toBe(false)
    expect(areViewConfigsEqual(views, [
      { ...views[0], expression: 'hasUnread == false' },
      views[1],
    ])).toBe(false)
  })
})
