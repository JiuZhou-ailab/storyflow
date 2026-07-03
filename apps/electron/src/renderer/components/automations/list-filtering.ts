// input: Automation list items, sidebar category filters, and search queries
// output: Filtered and newest-first automation rows for navigator rendering
// pos: Pure list derivation layer for AutomationsListPanel

import {
  APP_EVENTS,
  AGENT_EVENTS,
  getEventDisplayName,
  type AutomationListItem,
  type AutomationFilterKind,
} from './types'

const APP_EVENT_SET = new Set<string>(APP_EVENTS)
const AGENT_EVENT_SET = new Set<string>(AGENT_EVENTS)

function matchesCategory(automation: AutomationListItem, kind: AutomationFilterKind): boolean {
  if (kind === 'all') return true
  if (kind === 'scheduled') return automation.event === 'SchedulerTick'
  if (kind === 'app') return APP_EVENT_SET.has(automation.event) && automation.event !== 'SchedulerTick'
  if (kind === 'agent') return AGENT_EVENT_SET.has(automation.event)
  return true
}

function matchesSearch(automation: AutomationListItem, query: string): boolean {
  if (!query) return true
  return (
    automation.name.toLowerCase().includes(query) ||
    automation.summary.toLowerCase().includes(query) ||
    getEventDisplayName(automation.event).toLowerCase().includes(query)
  )
}

export function selectAutomationsForList(
  automations: AutomationListItem[],
  kind: AutomationFilterKind,
  searchQuery: string,
): AutomationListItem[] {
  const query = searchQuery.toLowerCase()
  const rows: { automation: AutomationListItem; lastExecutedAt: number }[] = []

  for (const automation of automations) {
    if (!matchesCategory(automation, kind)) continue
    if (!matchesSearch(automation, query)) continue
    rows.push({
      automation,
      lastExecutedAt: automation.lastExecutedAt ?? Number.NEGATIVE_INFINITY,
    })
  }

  rows.sort((a, b) => b.lastExecutedAt - a.lastExecutedAt)
  return rows.map(row => row.automation)
}
