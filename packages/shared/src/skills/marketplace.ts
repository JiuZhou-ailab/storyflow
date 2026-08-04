// input: Skills Market catalog responses with popularity metrics, install deep links, and portable Skill bundles
// output: Browser-safe marketplace contracts, publisher provenance, URL construction, and digest verification
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
  publisher: {
    id: string
    displayName: string
  }
  visibility: 'public' | 'company'
  license: string
  tags: string[]
  roots: string[]
  downloadCount: number
  featured?: boolean
  recommendation?: {
    order: number
    label: string
    sourceName: string
    sourceUrl: string
    snapshotAt: string
  }
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

export function parseMarketSkillListResponse(value: unknown): MarketSkillListResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Skills Market returned an invalid catalog')
  }
  const response = value as Record<string, unknown>
  if (!Array.isArray(response.skills) || typeof response.total !== 'number') {
    throw new Error('Skills Market returned an invalid catalog')
  }
  return {
    skills: response.skills.map(parseMarketSkillSummary),
    total: response.total,
  }
}

export function parseMarketSkillDetail(value: unknown): MarketSkillDetail {
  const summary = parseMarketSkillSummary(value)
  const detail = value as Record<string, unknown>
  const manifestErrors = validateStoryflowSkillManifest(detail.manifest)
  if (
    typeof detail.skillMarkdown !== 'string'
    || typeof detail.downloadPath !== 'string'
    || typeof detail.installUrl !== 'string'
    || manifestErrors.length > 0
  ) {
    throw new Error('Skills Market returned an invalid Skill detail')
  }
  const manifest = detail.manifest as StoryflowSkillManifest
  if (manifest.slug !== summary.slug || manifest.version !== summary.version) {
    throw new Error('Skills Market returned mismatched Skill detail')
  }
  return {
    ...summary,
    skillMarkdown: detail.skillMarkdown,
    manifest,
    downloadPath: detail.downloadPath,
    installUrl: detail.installUrl,
  }
}

function parseMarketSkillSummary(value: unknown): MarketSkillSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Skills Market returned an invalid Skill')
  }
  const skill = value as Record<string, unknown>
  const requiredStrings = ['slug', 'version', 'displayName', 'summary', 'author', 'license', 'sha256']
  if (
    !requiredStrings.every(key => typeof skill[key] === 'string')
    || !Array.isArray(skill.tags)
    || skill.tags.some(tag => typeof tag !== 'string')
    || !Array.isArray(skill.roots)
    || skill.roots.some(root => typeof root !== 'string')
    || (skill.downloadCount !== undefined && (
      typeof skill.downloadCount !== 'number'
      || !Number.isSafeInteger(skill.downloadCount)
      || skill.downloadCount < 0
    ))
    || (skill.featured !== undefined && typeof skill.featured !== 'boolean')
    || !isRecommendation(skill.recommendation)
    || (skill.publishedAt !== undefined && typeof skill.publishedAt !== 'string')
  ) {
    throw new Error('Skills Market returned an invalid Skill')
  }
  const publisher = skill.publisher
  const normalizedPublisher = publisher && typeof publisher === 'object' && !Array.isArray(publisher)
    && typeof (publisher as Record<string, unknown>).id === 'string'
    && typeof (publisher as Record<string, unknown>).displayName === 'string'
    ? publisher as MarketSkillSummary['publisher']
    : { id: `legacy:${skill.slug as string}`, displayName: skill.author as string }
  const visibility = skill.visibility === 'company' ? 'company' : 'public'
  return {
    slug: skill.slug as string,
    version: skill.version as string,
    displayName: skill.displayName as string,
    summary: skill.summary as string,
    author: skill.author as string,
    publisher: normalizedPublisher,
    visibility,
    license: skill.license as string,
    tags: skill.tags as string[],
    roots: skill.roots as string[],
    downloadCount: typeof skill.downloadCount === 'number' ? skill.downloadCount : 0,
    ...(typeof skill.featured === 'boolean' ? { featured: skill.featured } : {}),
    ...(skill.recommendation ? { recommendation: skill.recommendation as MarketSkillSummary['recommendation'] } : {}),
    ...(typeof skill.publishedAt === 'string' ? { publishedAt: skill.publishedAt } : {}),
    sha256: skill.sha256 as string,
  }
}

function isRecommendation(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const recommendation = value as Record<string, unknown>
  if (!Number.isSafeInteger(recommendation.order) || (recommendation.order as number) <= 0) return false
  if (!['label', 'sourceName', 'sourceUrl', 'snapshotAt']
    .every(key => typeof recommendation[key] === 'string' && Boolean((recommendation[key] as string).trim()))) return false
  try {
    const source = new URL(recommendation.sourceUrl as string)
    return (source.protocol === 'https:' || source.protocol === 'http:')
      && /^\d{4}-\d{2}-\d{2}$/.test(recommendation.snapshotAt as string)
  } catch {
    return false
  }
}

export interface DownloadedMarketSkill {
  bundle: ResourceBundle
  raw: string
  sha256: string
}

export interface SkillPublicationMetadata {
  version: string
  displayName: string
  summary: string
  license: string
  tags?: string[]
  visibility: 'public' | 'company'
}

export interface SkillMarketPublishInput {
  bundle: ResourceBundle
  publication: SkillPublicationMetadata
}

export interface SkillMarketPublishResult {
  status: 'published'
  slug: string
  version: string
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
  if (manifest.tags !== undefined && (
    !Array.isArray(manifest.tags)
    || manifest.tags.length > 12
    || manifest.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 32)
  )) {
    errors.push('tags must contain at most 12 non-empty strings of 32 characters or less')
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

/**
 * Add publication metadata without mutating the local Skill directory. The
 * Package Slug comes from the exported directory, not from SKILL.md's name.
 */
export function prepareMarketSkillBundle(
  input: SkillMarketPublishInput,
  author: StoryflowSkillManifest['author'],
): ResourceBundle {
  const skills = input.bundle?.resources?.skills
  if (input.bundle?.version !== 1 || !Array.isArray(skills) || skills.length !== 1) {
    throw new Error('Publishing requires exactly one exported Skill')
  }
  if (input.bundle.resources.sources || input.bundle.resources.automations) {
    throw new Error('Publishing accepts only one Skill')
  }

  const skill = skills[0]!
  const existingFile = skill.files.find(file => file.relativePath === STORYFLOW_SKILL_MANIFEST_FILE)
  let existing: Partial<StoryflowSkillManifest> = {}
  if (existingFile) {
    try {
      existing = JSON.parse(decodeBundleText(existingFile.contentBase64)) as Partial<StoryflowSkillManifest>
    } catch {
      throw new Error(`${STORYFLOW_SKILL_MANIFEST_FILE} must contain valid UTF-8 JSON`)
    }
  }
  const existingAuthor = existing.author && typeof existing.author === 'object'
    ? existing.author as Record<string, unknown>
    : null
  const authorName = typeof existingAuthor?.name === 'string' && existingAuthor.name.trim()
    ? existingAuthor.name.trim()
    : author.name.trim()
  const authorUrl = typeof existingAuthor?.url === 'string' && existingAuthor.url.trim()
    ? existingAuthor.url.trim()
    : author.url?.trim()

  const manifest: StoryflowSkillManifest = {
    ...existing,
    schemaVersion: 1,
    slug: skill.slug,
    version: input.publication.version.trim(),
    displayName: input.publication.displayName.trim(),
    summary: input.publication.summary.trim(),
    license: input.publication.license.trim(),
    author: {
      name: authorName,
      ...(authorUrl ? { url: authorUrl } : {}),
    },
    tags: [...new Set((input.publication.tags ?? []).map(tag => tag.trim()).filter(Boolean))],
  }
  const errors = validateStoryflowSkillManifest(manifest)
  if (errors.length > 0) throw new Error(`Invalid publication metadata: ${errors.join('; ')}`)

  const content = `${JSON.stringify(manifest, null, 2)}\n`
  const bytes = new TextEncoder().encode(content)
  const manifestFile = {
    relativePath: STORYFLOW_SKILL_MANIFEST_FILE,
    contentBase64: encodeBase64(bytes),
    size: bytes.byteLength,
  }
  return {
    ...input.bundle,
    exportedAt: Date.now(),
    resources: {
      skills: [{
        ...skill,
        files: [...skill.files.filter(file => file.relativePath !== STORYFLOW_SKILL_MANIFEST_FILE), manifestFile],
      }],
    },
  }
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

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function decodeBundleText(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
