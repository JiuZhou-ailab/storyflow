// input: AiSettingsPage source
// output: Regression checks for settings-page render-path derived values
// pos: Guards workspace override cards from repeated collapsed-summary scans

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../AiSettingsPage.tsx', import.meta.url), 'utf8')

describe('AiSettingsPage render path', () => {
  it('memoizes workspace override summary text instead of recomputing it during render', () => {
    expect(source).toContain('const summary = useMemo(() => {')
    expect(source).toContain(': summary')
    expect(source).toContain('workspaceEffectiveConnection?.name || settings.defaultLlmConnection')
    expect(source).not.toContain('const getSummary = () =>')
    expect(source).not.toContain(': getSummary()')
    expect(source).not.toContain('const conn = llmConnections.find(c => c.slug === settings.defaultLlmConnection)')
  })

  it('rejects managed connections before reading or editing API keys', () => {
    const ownershipGuard = "if (conn.hidden || conn.managed || conn.source === 'builtin') return null"
    const editMethodLookup = 'const method = getApiKeyMethodForConnection(connection)'
    const credentialRead = 'getLlmConnectionApiKey(connection.slug)'

    expect(source).toContain(ownershipGuard)
    expect(source.indexOf(editMethodLookup)).toBeLessThan(source.indexOf(credentialRead))
    expect(source).toContain('if (!method) return')
  })
})
