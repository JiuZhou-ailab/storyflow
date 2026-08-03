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
    expect(source).toContain('window.electronAPI.downloadSkillFromMarket(skill)')
    expect(source).toContain("'skip',")
    expect(source).toContain("{ skillScope: 'project' }")
    expect(source).toContain('currentWorkspaceId.current !== targetWorkspaceId')
  })

  it('keeps reference-only entries visible but disables installation', () => {
    expect(source).toContain('window.electronAPI.listSkillsFromMarket()')
    expect(source).not.toContain('DEFAULT_SKILLS_MARKET_ORIGIN')
    expect(source).toContain('isInstallableMarketSkill(skill)')
    expect(source).toContain("t('skillsHub.referenceOnly', '仅供参考')")
  })

  it('reloads the uncached catalog after a successful publication', () => {
    expect(source).toContain('onPublished={() => setReloadToken(value => value + 1)}')
  })

  it('bounds large installed catalogs without a horizontal scroll track', () => {
    expect(source).toContain('const INSTALLED_SKILLS_PREVIEW_LIMIT = 10')
    expect(source).toContain('filteredInstalledSkills.slice(0, INSTALLED_SKILLS_PREVIEW_LIMIT)')
    expect(source).toContain('aria-expanded={showAllInstalled}')
    expect(source).not.toContain('mt-3 flex gap-2 overflow-x-auto')
  })

  it('manages each installed Skill in place and confirms removal through the shared dialog', () => {
    expect(source).toContain("import { SkillRemovalDialog } from '@/components/app-shell/SkillMenu'")
    expect(source).toContain('isDefaultGlobalAgentSkillSlug(getInstalledMarketSlug(skill) ?? skill.slug)')
    expect(source).toContain('setSkillToRemove(skill)')
    expect(source).toContain("? 'Storyflow'")
    expect(source).toContain('<SkillRemovalDialog')
    expect(source).not.toContain('window.electronAPI.deleteSkill')
  })

  it('keeps free-form tags as search metadata instead of primary navigation', () => {
    expect(source).toContain("skill.tags.join(' ')")
    expect(source).not.toContain('selectedTag')
    expect(source).not.toContain('marketSkills.flatMap(skill => skill.tags)')
    expect(source).not.toContain("t('skillsHub.tags'")
  })

  it('searches and displays authenticated publisher provenance separately from content attribution', () => {
    expect(source).toContain('skill.publisher.displayName')
    expect(source).toContain("skill.visibility === 'company'")
    expect(source).toContain("t('skillsHub.publishedBy'")
    expect(source).toContain("t('skillsHub.contentSource'")
  })
})
