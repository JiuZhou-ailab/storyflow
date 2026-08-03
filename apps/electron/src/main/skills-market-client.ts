// input: Exported single-Skill bundle, publication metadata, fallback author identity, and ephemeral token
// output: Authenticated catalog reads, verified bundle downloads, and immutable publication results
// pos: Main-process network boundary that keeps all Skills Market capabilities out of the renderer

import {
  DEFAULT_SKILLS_MARKET_ORIGIN,
  downloadMarketSkillBundle,
  parseMarketSkillListResponse,
  prepareMarketSkillBundle,
  type DownloadedMarketSkill,
  type MarketSkillListResponse,
  type MarketSkillSummary,
  type SkillMarketPublishInput,
  type SkillMarketPublishResult,
  type StoryflowSkillManifest,
} from '@craft-agent/shared/skills/marketplace'

type MarketFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface MarketClientOptions {
  token?: string
  fetchImpl: MarketFetch
}

export async function listSkillsFromMarket(options: MarketClientOptions): Promise<MarketSkillListResponse> {
  const response = await options.fetchImpl(`${DEFAULT_SKILLS_MARKET_ORIGIN}/api/skills`, {
    headers: marketHeaders(options.token),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Skills Market request failed (${response.status})`)
  return parseMarketSkillListResponse(await response.json())
}

export function downloadSkillFromMarket(
  input: Pick<MarketSkillSummary, 'slug' | 'version' | 'sha256'>,
  options: MarketClientOptions,
): Promise<DownloadedMarketSkill> {
  return downloadMarketSkillBundle(input, {
    fetchImpl: (url, init) => options.fetchImpl(url, {
      ...init,
      headers: marketHeaders(options.token, init?.headers),
    }),
  })
}

export async function publishSkillToMarket(
  input: SkillMarketPublishInput,
  options: {
    author: StoryflowSkillManifest['author']
    token: string
    fetchImpl: MarketFetch
  },
): Promise<SkillMarketPublishResult> {
  const bundle = prepareMarketSkillBundle(input, options.author)
  const url = new URL('/api/submissions', DEFAULT_SKILLS_MARKET_ORIGIN)
  url.searchParams.set('visibility', input.publication.visibility)
  const response = await options.fetchImpl(url, {
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

function marketHeaders(token?: string, initial?: HeadersInit): Headers {
  const headers = new Headers(initial)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}
