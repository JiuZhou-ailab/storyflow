// input: LLM connection renderer state owners
// output: Regression coverage for LLM connection subscription boundaries
// pos: Keeps AI settings off broad app shell context updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')
const aiSettingsSource = readFileSync(new URL('../../pages/settings/AiSettingsPage.tsx', import.meta.url), 'utf-8')

describe('LLM connection subscriptions', () => {
  it('keeps AI settings off the broad app shell context', () => {
    expect(aiSettingsSource).not.toContain('useAppShellContext')
    expect(aiSettingsSource).toContain('llmConnectionsAtom')
    expect(aiSettingsSource).toContain('refreshLlmConnectionsAtom')
    expect(aiSettingsSource).toContain('windowWorkspaceIdAtom')
  })

  it('keeps LLM connection refresh state behind shared atoms', () => {
    expect(appSource).not.toContain('useState<LlmConnectionWithStatus[]>([])')
    expect(appSource).toContain('llmConnectionsAtom')
    expect(appSource).toContain('workspaceDefaultLlmConnectionAtom')
    expect(appSource).toContain('refreshLlmConnectionsAtom')
  })
})
