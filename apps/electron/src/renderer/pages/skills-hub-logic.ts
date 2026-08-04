// input: Skills Market summaries, installed Skill metadata, and external Markdown targets
// output: Pure catalog filtering, installability, slug, frontmatter, and URL policy decisions
// pos: Browser-independent policy boundary for the Skills Hub

import type { MarketSkillSummary } from '@craft-agent/shared/skills/marketplace'
import type { LoadedSkill } from '../../shared/types'

export type CatalogView = 'company' | 'featured' | 'all'

export function stripSkillFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

export function normalizeMarketSkillExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export function filterMarketSkills(
  skills: MarketSkillSummary[],
  query: string,
  view: CatalogView,
): MarketSkillSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return skills.filter((skill) => {
    if (view === 'company' && skill.visibility !== 'company') return false
    if (!normalizedQuery && view === 'featured' && !skill.featured) return false
    if (!normalizedQuery) return true
    return [
      skill.displayName,
      skill.summary,
      skill.author,
      skill.publisher.displayName,
      skill.tags.join(' '),
      skill.recommendation?.label,
      skill.recommendation?.sourceName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  })
}

export function isInstallableMarketSkill(skill: MarketSkillSummary): boolean {
  return /^[a-f0-9]{64}$/.test(skill.sha256)
}

export function getInstalledMarketSlug(skill: LoadedSkill): string | null {
  if (skill.origin !== 'top-level') return null
  const segments = skill.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return segments.at(-1) || null
}
