// input: Current-workspace persisted per-session token totals
// output: Regression coverage for scoped usage aggregation and routing
// pos: Minimal runnable check for the App settings local usage section

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { summarizeLocalUsage } from '../local-usage'

const source = readFileSync(new URL('../LocalUsageSection.tsx', import.meta.url), 'utf8')

describe('summarizeLocalUsage', () => {
  it('aggregates persisted usage for one runtime workspace', () => {
    const session = (inputTokens: number, outputTokens: number) => ({
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        contextTokens: 0,
        costUsd: 0,
      },
    })

    expect(summarizeLocalUsage([
      session(100, 20),
      session(30, 10),
      session(400, 40),
    ])).toEqual({
      totalTokens: 600,
      inputTokens: 530,
      outputTokens: 70,
      sessionCount: 3,
    })
  })

  it('queries only the current runtime workspace', () => {
    expect(source).toContain('const { runtimeWorkspace } = useAccountSettings()')
    expect(source).toContain('listSessionsByWorkspace(runtimeWorkspace.id)')
    expect(source).not.toContain('for (const workspace')
  })
})
