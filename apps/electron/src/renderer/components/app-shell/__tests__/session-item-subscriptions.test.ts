// input: SessionItem source and messaging binding subscription contracts
// output: Regression coverage for per-row subscription boundaries
// pos: Keeps session rows from rerendering for unrelated messaging binding updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const sessionItemSource = readFileSync(new URL('../SessionItem.tsx', import.meta.url), 'utf-8')
const sessionBadgesSource = readFileSync(new URL('../SessionBadges.tsx', import.meta.url), 'utf-8')
const sessionListSource = readFileSync(new URL('../SessionList.tsx', import.meta.url), 'utf-8')

describe('session item subscriptions', () => {
  it('reads messaging bindings through a per-session atom', () => {
    expect(sessionItemSource).toContain('messagingBindingsForSessionAtomFamily')
    expect(sessionItemSource).toContain('useAtomValue(messagingBindingsForSessionAtomFamily(item.id))')
    expect(sessionItemSource).not.toContain('useAtomValue(messagingBindingsBySessionAtom)')
    expect(sessionItemSource).not.toContain('messagingBindingsBySession.get(item.id)')
  })

  it('keeps list-level app shell and action subscriptions out of each row', () => {
    expect(sessionListSource).toContain("useActionLabel('chat.nextSearchMatch')")
    expect(sessionListSource).toContain("useActionLabel('chat.prevSearchMatch')")
    expect(sessionListSource).toContain('hasRemoteWorkspaces,')
    expect(sessionListSource).toContain('isCompactMode,')
    expect(sessionItemSource).toContain('ctx.nextSearchMatchHotkey')
    expect(sessionItemSource).toContain('ctx.prevSearchMatchHotkey')
    expect(sessionItemSource).not.toContain('useAppShellContext')
    expect(sessionItemSource).not.toContain('useActionLabel')
  })

  it('reuses a label lookup map instead of scanning labels per row badge', () => {
    expect(sessionListSource).toContain('const labelById = useMemo')
    expect(sessionListSource).toContain('labelById,')
    expect(sessionItemSource).toContain('ctx.labelById.has(labelId)')
    expect(sessionBadgesSource).toContain('ctx.labelById.get(parsed.id)')
    expect(sessionItemSource).not.toContain('ctx.flatLabels.some')
    expect(sessionBadgesSource).not.toContain('ctx.flatLabels.find')
  })

  it('keeps session list bucket order without re-sorting rows inside each group', () => {
    expect(sessionListSource).toContain('const unreadRows: SessionListRow[] = []')
    expect(sessionListSource).toContain('const groupsByKey = new Map<string, { rows: SessionListRow[], statusId: string }>()')
    expect(sessionListSource).not.toContain('unreadRows.sort((a, b) =>')
    expect(sessionListSource).not.toContain('readRows.sort((a, b) =>')
    expect(sessionListSource).not.toContain('groupRows.sort((a, b) =>')
  })
})
