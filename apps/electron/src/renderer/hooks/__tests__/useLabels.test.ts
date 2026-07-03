// input: Workspace label config trees
// output: Equality guard coverage for label refresh state writes
// pos: Keeps label config refreshes from invalidating AppShell consumers on no-op changes

import { describe, expect, it } from 'bun:test'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { areLabelTreesEqual } from '../useLabels'

const labels: LabelConfig[] = [
  {
    id: 'work',
    name: 'Work',
    color: { light: '#111111', dark: '#eeeeee' },
    autoRules: [{ pattern: 'JIRA-(\\d+)', flags: 'gi', valueTemplate: '$1', description: 'issue' }],
    children: [
      { id: 'frontend', name: 'Frontend', color: 'info/80', valueType: 'string' },
    ],
  },
]

describe('areLabelTreesEqual', () => {
  it('treats equivalent nested label trees as equal', () => {
    expect(areLabelTreesEqual(labels, structuredClone(labels))).toBe(true)
  })

  it('treats order and matching fields as meaningful', () => {
    expect(areLabelTreesEqual(labels, [
      { ...labels[0], children: [{ id: 'backend', name: 'Backend' }, labels[0].children![0]] },
    ])).toBe(false)

    expect(areLabelTreesEqual(labels, [
      { ...labels[0], autoRules: [{ ...labels[0].autoRules![0], valueTemplate: '$2' }] },
    ])).toBe(false)
  })
})
