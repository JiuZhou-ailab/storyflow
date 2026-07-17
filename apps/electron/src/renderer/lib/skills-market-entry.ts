// input: Public build-time availability flag and the fixed Skills Market identity
// output: A discovery entry only when the separately deployed Market is explicitly enabled
// pos: Fail-closed boundary separating service availability from registry trust

import { DEFAULT_SKILLS_MARKET_ORIGIN } from '@craft-agent/shared/skills/marketplace'

export interface SkillsMarketEntry {
  origin: typeof DEFAULT_SKILLS_MARKET_ORIGIN
}

export function resolveSkillsMarketEntry(enabled: string | undefined): SkillsMarketEntry | null {
  if (enabled !== 'true') return null
  return { origin: DEFAULT_SKILLS_MARKET_ORIGIN }
}
