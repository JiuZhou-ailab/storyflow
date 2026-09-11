// input: Explicit project target, immutable Market identity, and main-process download/import APIs
// output: Verified project installation without overwriting existing Skills or following workspace changes
// pos: Shared installation transaction for catalog and external-link entry points

import type { MarketSkillSummary } from '@craft-agent/shared/skills/marketplace'
import type { ElectronAPI } from '../../shared/types'

export async function installMarketSkill(
  api: Pick<ElectronAPI, 'downloadSkillFromMarket' | 'importResources'>,
  skill: Pick<MarketSkillSummary, 'slug' | 'version' | 'sha256'>,
  workspaceId: string,
  isCurrentWorkspace: () => boolean,
): Promise<'installed' | 'exists'> {
  const downloaded = await api.downloadSkillFromMarket(skill)
  if (!isCurrentWorkspace()) throw new Error('The active project changed. Please install again in the intended project.')
  const result = await api.importResources(workspaceId, downloaded.bundle, 'skip', {
    skillScope: 'project',
    installArtifact: {
      slug: skill.slug,
      version: skill.version,
      sha256: downloaded.sha256,
      raw: downloaded.raw,
    },
  })
  if (result.skills.imported.includes(skill.slug)) return 'installed'
  if (result.skills.skipped.includes(skill.slug)) return 'exists'
  throw new Error(result.skills.failed.find(item => item.id === skill.slug)?.error ?? 'Skill installation failed')
}
