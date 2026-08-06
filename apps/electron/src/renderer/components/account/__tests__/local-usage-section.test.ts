// input: Workspace metadata and persisted per-session token totals
// output: Regression coverage for local usage aggregation and ordering
// pos: Minimal runnable check for the App settings local usage section

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { summarizeLocalUsage } from '../local-usage'

const source = readFileSync(new URL('../LocalUsageSection.tsx', import.meta.url), 'utf8')

describe('summarizeLocalUsage', () => {
  it('aggregates persisted usage and orders projects by total tokens', () => {
    const workspaces = [
      { id: 'a', name: '项目 A' },
      { id: 'b', name: '项目 B' },
    ]
    const session = (inputTokens: number, outputTokens: number) => ({
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        contextTokens: 0,
        costUsd: 0,
      },
    })

    expect(summarizeLocalUsage(workspaces, [
      [session(100, 20), session(30, 10)],
      [session(400, 40)],
    ])).toEqual({
      totalTokens: 600,
      inputTokens: 530,
      outputTokens: 70,
      sessionCount: 3,
      workspaceUsage: [
        { id: 'b', name: '项目 B', totalTokens: 440 },
        { id: 'a', name: '项目 A', totalTokens: 160 },
      ],
    })
  })

  it('includes free conversations and preserves partial results', () => {
    expect(source).toContain('FREE_CONVERSATION_WORKSPACE_ID')
    expect(source).toContain('for (const workspace of usageWorkspaces)')
    expect(source).toContain('if (cancelled) return')
    expect(source).toContain('successfulWorkspaces')
    expect(source).toContain("t('settings.app.localUsage.partial')")
  })
})
