// input: SkillsHubPage source and its catalog/install contracts
// output: Regression coverage for local authority and safe one-click installation
// pos: Small source-level check isolated from Electron's browser-only dependency graph

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../SkillsHubPage.tsx', import.meta.url), 'utf8')

describe('SkillsHubPage contracts', () => {
  it('derives installed state from the Pi-native skills atom', () => {
    expect(source).toContain("import { skillsAtom } from '@/atoms/skills'")
    expect(source).toContain('useAtomValue(skillsAtom)')
    expect(source).toContain("if (skill.origin !== 'top-level') return null")
    expect(source).toContain("skill.path.replace(/\\\\/g, '/').replace(/\\/+$/, '').split('/')")
    expect(source).toContain('const marketSlug = getInstalledMarketSlug(skill)')
    expect(source).not.toContain('window.electronAPI.getSkills')
  })

  it('validates downloads and imports only into the active project', () => {
    expect(source).toContain('downloadMarketSkillBundle(skill)')
    expect(source).toContain("'skip',")
    expect(source).toContain("{ skillScope: 'project' }")
    expect(source).toContain('currentWorkspaceId.current !== targetWorkspaceId')
  })

  it('keeps reference-only entries visible but disables installation', () => {
    expect(source).toContain("fetch(`${DEFAULT_SKILLS_MARKET_ORIGIN}/api/skills`")
    expect(source).toContain("cache: 'no-store'")
    expect(source).toContain('isInstallableMarketSkill(skill)')
    expect(source).toContain("t('skillsHub.referenceOnly', '仅供参考')")
  })

  it('reloads the uncached catalog after a successful publication', () => {
    expect(source).toContain('onPublished={() => setReloadToken(value => value + 1)}')
  })
})
