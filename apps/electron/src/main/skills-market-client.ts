// input: Exported single-Skill bundle, publication metadata, author identity, and ephemeral token
// output: Immutable Skills Market publication result
// pos: Main-process network boundary that keeps publish capabilities out of the renderer

import {
  DEFAULT_SKILLS_MARKET_ORIGIN,
  prepareMarketSkillBundle,
  type SkillMarketPublishInput,
  type SkillMarketPublishResult,
  type StoryflowSkillManifest,
} from '@craft-agent/shared/skills/marketplace'

type MarketFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export async function publishSkillToMarket(
  input: SkillMarketPublishInput,
  options: {
    author: StoryflowSkillManifest['author']
    token: string
    fetchImpl: MarketFetch
  },
): Promise<SkillMarketPublishResult> {
  const bundle = prepareMarketSkillBundle(input, options.author)
  const response = await options.fetchImpl(`${DEFAULT_SKILLS_MARKET_ORIGIN}/api/submissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(bundle),
    signal: AbortSignal.timeout(60_000),
  })
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const issues = Array.isArray(body?.issues)
      ? body.issues.filter(issue => typeof issue === 'string').join('; ')
      : ''
    const message = typeof body?.error === 'string' ? body.error : `Skill publication failed (${response.status})`
    throw new Error(issues ? `${message}: ${issues}` : message)
  }
  if (
    body?.status !== 'published'
    || typeof body.slug !== 'string'
    || typeof body.version !== 'string'
    || typeof body.sha256 !== 'string'
  ) throw new Error('Skills Market returned an invalid publication result')
  return {
    status: 'published',
    slug: body.slug,
    version: body.version,
    sha256: body.sha256,
  }
}
