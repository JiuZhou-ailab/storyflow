// input: Skills Market catalog responses, install deep links, and portable Skill bundles
// output: Browser-safe marketplace contracts, URL construction, and digest verification
// pos: Shared protocol boundary between the public registry and Storyflow clients

import type { ResourceBundle } from '../resources/types.ts'

export const DEFAULT_SKILLS_MARKET_ORIGIN = 'https://storyflow-skills.zjding.com'
export const STORYFLOW_SKILL_MANIFEST_FILE = 'storyflow.json'

export interface SkillLayoutRoot {
  path: string
  label?: string
  role?: string
  order?: number
  create?: boolean
}

export interface StoryflowSkillManifest {
  schemaVersion: 1
  slug: string
  version: string
  displayName: string
  summary: string
  license: string
  author: {
    name: string
    url?: string
  }
  tags?: string[]
  methodology?: {
    sourceName: string
    sourceUrl: string
    adaptation: string
  }
  contributes?: {
    projectLayout?: {
      roots: SkillLayoutRoot[]
    }
    requiredSources?: string[]
  }
}

export interface MarketSkillSummary {
  slug: string
  version: string
  displayName: string
  summary: string
  author: string
  license: string
  tags: string[]
  roots: string[]
  featured?: boolean
  publishedAt?: string
  sha256: string
}

export interface MarketSkillDetail extends MarketSkillSummary {
  skillMarkdown: string
  manifest: StoryflowSkillManifest
  downloadPath: string
  installUrl: string
}

export interface MarketSkillListResponse {
  skills: MarketSkillSummary[]
  total: number
}

export interface DownloadedMarketSkill {
  bundle: ResourceBundle
  raw: string
  sha256: string
}

export type MarketFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function validateStoryflowSkillManifest(value: unknown): string[] {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Manifest must be an object']
  const manifest = value as Record<string, unknown>
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (typeof manifest.slug !== 'string' || manifest.slug.length > 64 || !SLUG_PATTERN.test(manifest.slug)) {
    errors.push('slug must be a lowercase kebab-case identifier')
  }
  if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) {
    errors.push('version must be semantic version syntax')
  }
  for (const field of ['displayName', 'summary', 'license'] as const) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) errors.push(`${field} is required`)
  }
  const author = manifest.author
  if (!author || typeof author !== 'object' || Array.isArray(author)
    || typeof (author as Record<string, unknown>).name !== 'string') {
    errors.push('author.name is required')
  }
  const contributes = manifest.contributes
  const projectLayout = contributes && typeof contributes === 'object'
    ? (contributes as Record<string, unknown>).projectLayout
    : undefined
  const roots = projectLayout && typeof projectLayout === 'object'
    ? (projectLayout as Record<string, unknown>).roots
    : undefined
  if (roots !== undefined) {
    if (!Array.isArray(roots)) {
      errors.push('contributes.projectLayout.roots must be an array')
    } else {
      const seen = new Set<string>()
      for (const [index, root] of roots.entries()) {
        const path = root && typeof root === 'object' ? (root as Record<string, unknown>).path : undefined
        if (typeof path !== 'string' || !isSafeProjectRelativePath(path)) {
          errors.push(`roots[${index}].path must be a safe project-relative path`)
        } else if (seen.has(path)) {
          errors.push(`roots[${index}].path is duplicated`)
        } else {
          seen.add(path)
        }
      }
    }
  }
  return errors
}

export function isSafeProjectRelativePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('//')) return false
  return normalized.split('/').every(segment => segment !== '.' && segment !== '..' && !segment.startsWith('.'))
}

export function buildMarketBundleUrl(
  slug: string,
  version: string,
  origin = DEFAULT_SKILLS_MARKET_ORIGIN,
): string {
  return `${origin.replace(/\/+$/, '')}/api/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/bundle`
}

export function buildSkillInstallDeepLink(skill: Pick<MarketSkillSummary, 'slug' | 'version' | 'sha256'>): string {
  const params = new URLSearchParams({
    slug: skill.slug,
    version: skill.version,
    sha256: skill.sha256,
  })
  return `craftagents://action/install-skill?${params.toString()}`
}

export async function downloadMarketSkillBundle(
  input: Pick<MarketSkillSummary, 'slug' | 'version' | 'sha256'>,
  options?: { origin?: string, fetchImpl?: MarketFetch },
): Promise<DownloadedMarketSkill> {
  if (!SLUG_PATTERN.test(input.slug) || !VERSION_PATTERN.test(input.version) || !/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new Error('Invalid Skills Market install request')
  }
  const fetchImpl = options?.fetchImpl ?? fetch
  const response = await fetchImpl(buildMarketBundleUrl(input.slug, input.version, options?.origin))
  if (!response.ok) throw new Error(`Skill download failed (${response.status})`)
  const raw = await response.text()
  if (new TextEncoder().encode(raw).byteLength > 5 * 1024 * 1024) throw new Error('Skill bundle exceeds 5 MB')
  const sha256 = await sha256Hex(raw)
  if (sha256 !== input.sha256) throw new Error('Skill bundle checksum does not match the registry')
  const bundle = JSON.parse(raw) as ResourceBundle
  const skill = bundle?.resources?.skills
  if (bundle?.version !== 1 || !Array.isArray(skill) || skill.length !== 1 || skill[0]?.slug !== input.slug) {
    throw new Error('Registry returned an invalid single-Skill bundle')
  }
  if (bundle.resources.sources || bundle.resources.automations) {
    throw new Error('Market bundles may contain only one Skill')
  }
  return { bundle, raw, sha256 }
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', owned.buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
