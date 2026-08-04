// input: SkillsHubPage source and its catalog/install contracts
// output: Regression coverage for local authority and safe one-click installation
// pos: Small source-level check isolated from Electron's browser-only dependency graph

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { MarketSkillSummary } from '@craft-agent/shared/skills/marketplace'
import {
  filterMarketSkills,
  getInstalledMarketSlug,
  isInstallableMarketSkill,
  normalizeMarketSkillExternalUrl,
  stripSkillFrontmatter,
} from '../skills-hub-logic'

const source = readFileSync(new URL('../SkillsHubPage.tsx', import.meta.url), 'utf8')
const skillAvatarSource = readFileSync(new URL('../../components/ui/skill-avatar.tsx', import.meta.url), 'utf8')
const marketSkill: MarketSkillSummary = {
  slug: 'story-structure',
  version: '1.0.0',
  displayName: 'Story Structure',
  summary: 'Build a reliable story structure',
  author: 'Method Team',
  publisher: { id: 'publisher', displayName: 'Studio' },
  visibility: 'public',
  license: 'MIT',
  tags: ['story'],
  roots: ['plot'],
  downloadCount: 2,
  featured: true,
  sha256: 'a'.repeat(64),
}

describe('SkillsHubPage contracts', () => {
  it('derives installed state from the Pi-native skills atom', () => {
    expect(source).toContain("import { skillsAtom } from '@/atoms/skills'")
    expect(source).toContain('useAtomValue(skillsAtom)')
    expect(source).toContain('const marketSlug = getInstalledMarketSlug(skill)')
    expect(source).not.toContain('window.electronAPI.getSkills')
    expect(getInstalledMarketSlug({ origin: 'top-level', path: '/skills/story-structure/' } as never))
      .toBe('story-structure')
    expect(getInstalledMarketSlug({ origin: 'extension', path: '/skills/story-structure' } as never))
      .toBeNull()
  })

  it('validates downloads and imports only into the active project', () => {
    expect(source).toContain('window.electronAPI.downloadSkillFromMarket(skill)')
    expect(source).toContain("'skip',")
    expect(source).toContain("{ skillScope: 'project' }")
    expect(source).toContain('currentWorkspaceId.current !== targetWorkspaceId')
  })

  it('keeps reference-only recommendations visible and links to their reviewed source', () => {
    expect(source).toContain('window.electronAPI.listSkillsFromMarket()')
    expect(source).not.toContain('DEFAULT_SKILLS_MARKET_ORIGIN')
    expect(source).toContain('isInstallableMarketSkill(skill)')
    expect(source).toContain("t('skillsHub.referenceOnly', '仅供参考')")
    expect(source).toContain("t('skillsHub.openSource', '查看来源')")
    expect(isInstallableMarketSkill(marketSkill)).toBe(true)
    expect(isInstallableMarketSkill({ ...marketSkill, sha256: '' })).toBe(false)
  })

  it('reloads the uncached catalog after a successful publication', () => {
    expect(source).toContain('onPublished={() => setReloadToken(value => value + 1)}')
  })

  it('resolves hidden runtime workspaces without hiding the header actions', () => {
    expect(source).toContain('windowRuntimeWorkspaceAtom')
    expect(source).toContain('useAtomValue(windowRuntimeWorkspaceAtom)')
    expect(source).toContain('disabled={!workspace || publishableSkills.length === 0}')
    expect(source).toContain("? t('workspace.loadingWorkspaces', '正在加载项目...')")
  })

  it('separates discovery and installed management into top-level tabs', () => {
    expect(source).toContain("type SkillsTab = 'discover' | 'installed'")
    expect(source).toContain('<TabsTrigger value="discover"')
    expect(source).toContain('<TabsTrigger value="installed"')
    expect(source).toContain('<TabsContent value="discover"')
    expect(source).toContain('<TabsContent value="installed"')
    expect(source).not.toContain('INSTALLED_SKILLS_PREVIEW_LIMIT')
    expect(source).not.toContain('mt-3 flex gap-2 overflow-x-auto')
  })

  it('shows installed descriptions in a readable two-column list', () => {
    expect(source).toContain('id="installed-skills-grid" className="grid grid-cols-1 gap-x-8 lg:grid-cols-2"')
    expect(source).toContain('{skill.metadata.description}')
    expect(source).not.toContain('block line-clamp-2')
  })

  it('keeps the fixed external SkillHub entry inside discovery', () => {
    expect(source).toContain("window.electronAPI.openUrl('https://skillhub.cn')")
    expect(source).toContain("t('skillsHub.browseSkillHub', '浏览 SkillHub')")
  })

  it('opens authenticated catalog details and renders Skill instructions', () => {
    expect(source).toContain('window.electronAPI.getSkillDetailFromMarket(skill.slug)')
    expect(source).toContain('stripSkillFrontmatter(detail.skillMarkdown)')
    expect(source).toContain('onClick={() => void openMarketSkill(skill)}')
    expect(source).toContain('<Info_Markdown mode="full"')
    expect(source).toContain('setSelectedMarketSkill(detail)')
    expect(source).toContain('const installTarget = marketSkillDetail ?? selectedMarketSkill')
    expect(stripSkillFrontmatter('---\nname: test\n---\n\n# Instructions')).toBe('# Instructions')
  })

  it('uses the installed Skill avatar UI for catalog icons', () => {
    expect(source).toContain('SkillAvatar, SkillVisualAvatar')
    expect(source).toContain('return resolveSkillVisual([skill.slug, skill.displayName, ...skill.tags, ...skill.roots])')
    expect(source).toContain('<SkillVisualAvatar')
    expect(source).not.toContain("'flex size-10 shrink-0 items-center justify-center rounded-lg'")
    expect(skillAvatarSource).toContain('const SKILL_VISUALS')
    expect(skillAvatarSource).toContain('export function SkillVisualAvatar')
    expect(skillAvatarSource).toContain('<SkillVisualAvatar')
    expect(skillAvatarSource.match(/<EntityIcon/g)).toHaveLength(1)
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
    expect(source).not.toContain('selectedTag')
    expect(source).not.toContain('marketSkills.flatMap(skill => skill.tags)')
    expect(source).not.toContain("t('skillsHub.tags'")
    expect(filterMarketSkills([marketSkill], 'studio', 'all')).toEqual([marketSkill])
    expect(filterMarketSkills([{ ...marketSkill, featured: false }], '', 'featured')).toEqual([])
  })

  it('searches and displays authenticated publisher provenance separately from content attribution', () => {
    expect(source).toContain('skill.publisher.displayName')
    expect(source).toContain("skill.visibility === 'company'")
    expect(source).toContain("t('skillsHub.publishedBy'")
    expect(source).toContain("t('skillsHub.contentSource'")
    expect(source).toContain('flex min-w-0 gap-2 overflow-hidden whitespace-nowrap text-xs')
  })

  it('separates external recommendation evidence from Market download counts', () => {
    expect(source).toContain('skill.downloadCount')
    expect(source).toContain('skill.recommendation.label')
    expect(source).toContain("t('skillsHub.downloadCount'")
    expect(filterMarketSkills([marketSkill], '', 'featured')).toEqual([marketSkill])
  })

  it('uses button semantics and blocks remote Markdown image requests', () => {
    expect(source).toContain('role="group"')
    expect(source).toContain('aria-pressed={catalogView === view}')
    expect(source).not.toContain('role="tab"')
    expect(source).toContain('allowImages={false}')
    expect(source).toContain('onUrlClick={onOpenUrl}')
    expect(normalizeMarketSkillExternalUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeMarketSkillExternalUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeMarketSkillExternalUrl('file:///tmp/private')).toBeNull()
  })
})
