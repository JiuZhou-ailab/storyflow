import { describe, expect, it } from 'bun:test'
import type { AutomationListItem, AutomationTrigger } from '../types'
import { selectAutomationsForList } from '../list-filtering'

function automation(overrides: Partial<AutomationListItem> & Pick<AutomationListItem, 'id' | 'event'>): AutomationListItem {
  return {
    id: overrides.id,
    event: overrides.event,
    matcherIndex: overrides.matcherIndex ?? 0,
    name: overrides.name ?? overrides.id,
    summary: overrides.summary ?? '',
    enabled: overrides.enabled ?? true,
    actions: overrides.actions ?? [],
    lastExecutedAt: overrides.lastExecutedAt,
  }
}

describe('selectAutomationsForList', () => {
  it('filters by automation category and sorts newest executions first with never-run entries last', () => {
    const items = [
      automation({ id: 'old-app', event: 'LabelAdd', lastExecutedAt: 10 }),
      automation({ id: 'agent', event: 'UserPromptSubmit', lastExecutedAt: 30 }),
      automation({ id: 'scheduled', event: 'SchedulerTick', lastExecutedAt: 20 }),
      automation({ id: 'new-app', event: 'FlagChange', lastExecutedAt: 40 }),
      automation({ id: 'never-app', event: 'TodoStateChange' }),
    ]

    expect(selectAutomationsForList(items, 'app', '').map(item => item.id)).toEqual([
      'new-app',
      'old-app',
      'never-app',
    ])
    expect(selectAutomationsForList(items, 'agent', '').map(item => item.id)).toEqual(['agent'])
    expect(selectAutomationsForList(items, 'scheduled', '').map(item => item.id)).toEqual(['scheduled'])
  })

  it('filters search text against name, summary, and display event name', () => {
    const items = [
      automation({ id: 'name-hit', event: 'LabelAdd', name: 'Deploy docs', lastExecutedAt: 10 }),
      automation({ id: 'summary-hit', event: 'FlagChange', summary: 'Notify release channel', lastExecutedAt: 30 }),
      automation({ id: 'event-hit', event: 'UserPromptSubmit' as AutomationTrigger, lastExecutedAt: 20 }),
      automation({ id: 'miss', event: 'TodoStateChange', name: 'Other', summary: 'No match', lastExecutedAt: 40 }),
    ]

    expect(selectAutomationsForList(items, 'all', 'release').map(item => item.id)).toEqual(['summary-hit'])
    expect(selectAutomationsForList(items, 'all', 'message').map(item => item.id)).toEqual(['event-hit'])
  })
})
