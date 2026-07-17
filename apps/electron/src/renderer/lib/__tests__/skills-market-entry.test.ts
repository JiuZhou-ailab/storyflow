// input: Candidate public build-flag values for Skills Market availability
// output: Proof that only an exact true value exposes the fixed registry entry
// pos: Fail-closed product-surface contract for the separately deployed Market

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DEFAULT_SKILLS_MARKET_ORIGIN } from '@craft-agent/shared/skills/marketplace'
import { resolveSkillsMarketEntry } from '../skills-market-entry'

const skillsListPanel = readFileSync(
  new URL('../../components/app-shell/SkillsListPanel.tsx', import.meta.url),
  'utf8',
)

describe('resolveSkillsMarketEntry', () => {
  it.each([undefined, '', 'false', '1', 'TRUE'])('keeps %p disabled', (value) => {
    expect(resolveSkillsMarketEntry(value)).toBeNull()
  })

  it('enables only the fixed registry for an exact true value', () => {
    expect(resolveSkillsMarketEntry('true')).toEqual({
      origin: DEFAULT_SKILLS_MARKET_ORIGIN,
    })
  })

  it('guards the whole discovery entry without accepting an injected origin', () => {
    expect(skillsListPanel).toContain('{skillsMarketEntry && (')
    expect(skillsListPanel).toContain('window.electronAPI.openUrl(skillsMarketEntry.origin)')
    expect(skillsListPanel).not.toContain('VITE_STORYFLOW_SKILLS_MARKET_ORIGIN')
  })
})
