// input: Public catalog and bundle requests, authenticated submissions, Workers AI, D1 metadata, and private R2 packages
// output: Catalog APIs with download metrics, publisher provenance, immutable bundles, and reviewed publication
// pos: API-only Cloudflare Worker boundary; the Storyflow desktop app owns presentation and installation

import {
  buildSkillInstallDeepLink,
  type MarketSkillDetail,
  type MarketSkillSummary,
  type StoryflowSkillManifest,
} from '@craft-agent/shared/skills/marketplace'
import { decodeProtectedHeader, jwtVerify } from 'jose'
import { CURATED_SKILLS, type CuratedSkill } from './catalog.ts'
import { convertCuratedSkillArchive, readCuratedArchive, validateMarketBundle } from './packages.ts'
import { ReviewInputError, ReviewUnavailableError, reviewSkillBundle } from './review.ts'

interface R2ObjectLike {
  body: BodyInit | ReadableStream<Uint8Array> | null
}

interface R2BucketLike {
  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
}

interface D1Result<T = unknown> {
  results?: T[]
  success?: boolean
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
  batch(statements: D1PreparedStatementLike[]): Promise<D1Result[]>
}

interface WorkersAI {
  run(model: string, input: Record<string, unknown>): Promise<unknown>
}

export interface Env {
  DB?: D1DatabaseLike
  PACKAGES?: R2BucketLike
  AI?: WorkersAI
  STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID?: string
  STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET?: string
  STORYFLOW_SKILLS_MARKET_JWT_PREVIOUS_KEY_ID?: string
  STORYFLOW_SKILLS_MARKET_JWT_PREVIOUS_SECRET?: string
}

interface PublisherIdentity {
  subject: string
  name?: string
  organizationId?: string
}

interface PublishedRow {
  owner_id: string
  publisher_name: string | null
  visibility: 'public' | 'company'
  organization_id: string | null
  slug: string
  version: string
  display_name: string
  summary: string
  license: string
  tags_json: string
  sha256: string
  published_at: string
  object_key: string
  manifest_json: string
}

interface SkillMetricRow {
  slug: string
  download_count: number
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300'
const PRIVATE_CACHE = 'private, no-store'
const curatedPackageLoads = new Map<string, ReturnType<typeof loadCuratedPackageUncached>>()

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }))
  if (url.pathname === '/health') return json({ status: 'ok', catalog: CURATED_SKILLS.length })

  try {
    if (url.pathname === '/api/skills' && request.method === 'GET') return await listSkills(request, url, env)
    const bundleMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/versions\/([^/]+)\/bundle$/)
    if (bundleMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      return await downloadBundle(
        decodeURIComponent(bundleMatch[1]!),
        decodeURIComponent(bundleMatch[2]!),
        env,
        request.method === 'HEAD',
        request,
      )
    }
    const detailMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/)
    if (detailMatch && request.method === 'GET') {
      return await getSkillDetail(decodeURIComponent(detailMatch[1]!), request, env)
    }
    if (url.pathname === '/api/submissions' && request.method === 'POST') {
      return await submitSkill(request, url, env)
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500
    return json({ error: error instanceof Error ? error.message : 'Unexpected market error' }, status)
  }

  return json({ error: 'Not found' }, 404)
}

async function listSkills(request: Request, url: URL, env: Env): Promise<Response> {
  const identity = await readMarketIdentity(request, env, 'skills:read', false)
  const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase()
  const tag = (url.searchParams.get('tag') ?? '').trim().toLocaleLowerCase()
  const distribution = url.searchParams.get('distribution') ?? 'installable'
  const downloadCounts = await loadDownloadCounts(env)
  const seedSummaries = CURATED_SKILLS.map(seed => seedSummary(
    seed,
    downloadCounts.get(seed.slug) ?? 0,
  ))
  const published = await loadPublishedSummaries(env, identity?.organizationId, downloadCounts)
  const bySlug = new Map<string, MarketSkillSummary>(seedSummaries.map(item => [item.slug, item]))
  for (const item of published) bySlug.set(item.slug, item)
  const skills = sortMarketSkills([...bySlug.values()]).filter(skill => {
    if (distribution === 'installable' && !skill.sha256) return false
    if (distribution === 'reference-only' && skill.sha256) return false
    if (tag && !skill.tags.some(value => value.toLocaleLowerCase() === tag)) return false
    if (!query) return true
    return [skill.displayName, skill.summary, skill.author, skill.publisher.displayName, skill.tags.join(' ')]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query)
  })
  return json({ skills, total: skills.length }, 200, {
    'cache-control': identity ? PRIVATE_CACHE : PUBLIC_CACHE,
  })
}

async function getSkillDetail(slug: string, request: Request, env: Env): Promise<Response> {
  const identity = await readMarketIdentity(request, env, 'skills:read', false)
  const downloadCount = await loadDownloadCount(env, slug)
  const seed = CURATED_SKILLS.find(item => item.slug === slug)
  if (seed) {
    const detail = await seedDetail(seed, downloadCount, env)
    return json(detail, 200, { 'cache-control': PUBLIC_CACHE })
  }
  const row = await loadPublishedRow(slug, undefined, env, identity?.organizationId)
  if (!row) throw new RequestError(404, 'Skill not found')
  const packageObject = await env.PACKAGES?.get(row.object_key)
  if (!packageObject) throw new RequestError(503, 'Published package bytes are unavailable')
  const validated = await validateMarketBundle(await new Response(packageObject.body).text())
  const summary = publishedRowSummary(row, validated.manifest, downloadCount)
  const detail: MarketSkillDetail = {
    ...summary,
    skillMarkdown: validated.skillMarkdown,
    manifest: validated.manifest,
    downloadPath: `/api/skills/${encodeURIComponent(row.slug)}/versions/${encodeURIComponent(row.version)}/bundle`,
    installUrl: buildSkillInstallDeepLink(summary),
  }
  return json(detail, 200, { 'cache-control': identity ? PRIVATE_CACHE : PUBLIC_CACHE })
}

async function downloadBundle(
  slug: string,
  version: string,
  env: Env,
  headOnly = false,
  request?: Request,
): Promise<Response> {
  const identity = request
    ? await readMarketIdentity(request, env, 'skills:read', false)
    : null
  const curated = CURATED_SKILLS.find(seed => seed.slug === slug && seed.package?.version === version)
  if (curated?.package) {
    const bundle = await loadCuratedPackage(curated, env)
    if (headOnly) {
      return bundleResponse('', bundle.sha256, `${slug}-${version}.storyflow-skill.json`, true)
    }
    await recordDownload(env, slug)
    return bundleResponse(bundle.raw, bundle.sha256, `${slug}-${version}.storyflow-skill.json`)
  }
  const row = await loadPublishedRow(slug, version, env, identity?.organizationId)
  if (!row) throw new RequestError(404, 'Skill version not found')
  const object = await env.PACKAGES?.get(row.object_key)
  if (!object) throw new RequestError(503, 'Published package bytes are unavailable')
  const raw = await new Response(object.body).text()
  if (!headOnly) await recordDownload(env, slug)
  return bundleResponse(
    raw,
    row.sha256,
    `${slug}-${version}.storyflow-skill.json`,
    headOnly,
    row.visibility === 'company',
  )
}

async function submitSkill(request: Request, url: URL, env: Env): Promise<Response> {
  const identity = await readMarketIdentity(request, env, 'skills:publish', true)
  if (!identity) throw new RequestError(401, 'Skills Market publish token required')
  const visibility = url.searchParams.get('visibility') ?? 'public'
  if (visibility !== 'public' && visibility !== 'company') {
    throw new RequestError(400, 'Skill visibility must be public or company')
  }
  if (visibility === 'company' && !identity.organizationId) {
    throw new RequestError(403, 'Company publication requires company membership')
  }
  if (!env.DB || !env.PACKAGES || !env.AI) throw new RequestError(503, 'Publication services are not configured')
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 7 * 1024 * 1024) throw new RequestError(413, 'Submission exceeds 7 MB request limit')
  const submitted = await readBoundedSubmission(request)
  let validated: Awaited<ReturnType<typeof validateMarketBundle>>
  try {
    validated = await validateMarketBundle(submitted)
  } catch (error) {
    throw new RequestError(400, error instanceof Error ? error.message : 'Invalid Skill package')
  }
  if (CURATED_SKILLS.some(seed => seed.slug === validated.manifest.slug)) {
    throw new RequestError(409, 'This Skill slug is reserved by the curated catalog')
  }
  let review
  try {
    review = await reviewSkillBundle(validated, env.AI)
  } catch (error) {
    if (error instanceof ReviewInputError) throw new RequestError(400, error.message)
    if (error instanceof ReviewUnavailableError) {
      return json({ error: error.message, code: 'ai_review_unavailable' }, 503)
    }
    throw error
  }
  if (!review.approve) {
    return json({
      error: 'Automated review rejected this Skill',
      code: 'ai_review_rejected',
      issues: review.issues,
    }, 422)
  }

  const versionId = crypto.randomUUID()
  const skillId = `skill_${validated.manifest.slug}`
  const userId = `user_${(await digestText(identity.subject)).slice(0, 24)}`
  const now = new Date().toISOString()
  const publishedKey = `packages/${validated.manifest.slug}/${validated.manifest.version}/${validated.sha256}.json`

  await env.PACKAGES.put(publishedKey, validated.raw, { httpMetadata: { contentType: 'application/json' } })
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (id, access_subject, email, display_name, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(access_subject) DO UPDATE SET email=excluded.email, display_name=excluded.display_name`)
        .bind(userId, identity.subject, null, identity.name ?? null, now),
      env.DB.prepare(`INSERT INTO skills
        (id, owner_id, slug, display_name, summary, license, tags_json, visibility, organization_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET
        display_name=excluded.display_name, summary=excluded.summary, license=excluded.license,
        tags_json=excluded.tags_json, visibility=excluded.visibility,
        organization_id=excluded.organization_id, updated_at=excluded.updated_at
        WHERE skills.owner_id=excluded.owner_id`)
        .bind(skillId, userId, validated.manifest.slug, validated.manifest.displayName, validated.manifest.summary,
          validated.manifest.license, JSON.stringify(validated.manifest.tags ?? []), visibility,
          visibility === 'company' ? identity.organizationId ?? null : null, now, now),
      env.DB.prepare(`INSERT INTO skill_versions
        (id, skill_id, submitted_by, version, sha256, object_key, bytes, manifest_json, status,
         submitted_at, published_at, review_json, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)`)
        .bind(versionId, skillId, userId, validated.manifest.version, validated.sha256, publishedKey,
          validated.bytes, JSON.stringify(validated.manifest), now, now, JSON.stringify(review), now),
      env.DB.prepare('UPDATE skills SET current_version_id=?, updated_at=? WHERE id=? AND owner_id=?')
        .bind(versionId, now, skillId, userId),
    ])
  } catch (error) {
    if (error instanceof Error && /FOREIGN KEY/i.test(error.message)) {
      throw new RequestError(409, 'This Skill slug belongs to another publisher')
    }
    if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new RequestError(409, 'This version or package already exists')
    throw error
  }
  return json({
    ok: true,
    status: 'published',
    slug: validated.manifest.slug,
    version: validated.manifest.version,
    sha256: validated.sha256,
  }, 201)
}

function seedSummary(seed: CuratedSkill, downloadCount: number): MarketSkillSummary {
  const version = seed.package?.version ?? '1.0.0'
  return {
    slug: seed.slug,
    version,
    displayName: seed.displayName,
    summary: seed.summary,
    author: seed.sourceName,
    publisher: { id: 'storyflow-curation', displayName: 'Storyflow 精品推荐' },
    visibility: 'public',
    license: seed.license,
    tags: [...seed.tags, '上游来源'],
    roots: [],
    downloadCount,
    featured: true,
    recommendation: seed.recommendation,
    publishedAt: seed.package
      ? new Date(seed.package.publishedAt).toISOString()
      : `${seed.recommendation.snapshotAt}T00:00:00.000Z`,
    sha256: seed.package?.bundleSha256 ?? '',
  }
}

async function seedDetail(seed: CuratedSkill, downloadCount: number, env: Env): Promise<MarketSkillDetail> {
  const summary = seedSummary(seed, downloadCount)
  if (seed.package) {
    const bundle = await loadCuratedPackage(seed, env)
    return {
      ...summary,
      skillMarkdown: bundle.skillMarkdown,
      manifest: bundle.manifest,
      downloadPath: `/api/skills/${encodeURIComponent(seed.slug)}/versions/${encodeURIComponent(seed.package.version)}/bundle`,
      installUrl: buildSkillInstallDeepLink(summary),
    }
  }
  const manifest: StoryflowSkillManifest = {
    schemaVersion: 1, slug: seed.slug, version: '1.0.0', displayName: seed.displayName,
    summary: seed.summary, license: seed.license,
    author: { name: seed.sourceName, ...(seed.sourceUrl ? { url: seed.sourceUrl } : {}) },
    tags: seed.tags,
    methodology: {
      sourceName: seed.recommendation.sourceName,
      sourceUrl: seed.recommendation.sourceUrl,
      adaptation: `Popularity snapshot ${seed.recommendation.snapshotAt}: ${seed.recommendation.label}`,
    },
  }
  const sourceLine = seed.sourceUrl ? `\n- 上游：${seed.sourceUrl}` : ''
  const skillMarkdown = `---\nname: ${seed.slug}\ndescription: ${JSON.stringify(seed.summary)}\n---\n\n# ${seed.displayName}\n\n${seed.summary}\n${sourceLine}\n- 推荐依据：${seed.recommendation.label}\n- 数据快照：${seed.recommendation.snapshotAt}\n\n安装或复用前，请检查上游许可证、脚本和权限。\n`
  return { ...summary, skillMarkdown, manifest, downloadPath: '', installUrl: '' }
}

async function loadCuratedPackage(seed: CuratedSkill, env: Env) {
  const key = seed.package?.bundleSha256
  if (!key) throw new RequestError(404, 'Curated Skill package is unavailable')
  const pending = curatedPackageLoads.get(key) ?? loadCuratedPackageUncached(seed, env)
  curatedPackageLoads.set(key, pending)
  try {
    return await pending
  } finally {
    if (curatedPackageLoads.get(key) === pending) curatedPackageLoads.delete(key)
  }
}

async function loadCuratedPackageUncached(seed: CuratedSkill, env: Env) {
  const packageMetadata = seed.package
  if (!packageMetadata) throw new RequestError(404, 'Curated Skill package is unavailable')
  try {
    const object = await env.PACKAGES?.get(packageMetadata.objectKey)
    if (!object) throw new Error('pinned package object is missing')
    const archive = await readCuratedArchive(new Response(object.body))
    const bundle = await convertCuratedSkillArchive(seed, archive)
    if (bundle.sha256 !== packageMetadata.bundleSha256) throw new Error('converted package checksum changed')
    return bundle
  } catch (error) {
    throw new RequestError(503, `Curated Skill package is unavailable: ${error instanceof Error ? error.message : 'unexpected upstream failure'}`)
  }
}

async function loadPublishedSummaries(
  env: Env,
  organizationId: string | undefined,
  downloadCounts: ReadonlyMap<string, number>,
): Promise<MarketSkillSummary[]> {
  if (!env.DB) return []
  const result = await env.DB.prepare(`SELECT s.owner_id, u.display_name AS publisher_name,
    s.visibility, s.organization_id,
    s.slug, v.version, s.display_name, s.summary, s.license,
    s.tags_json, v.sha256, v.published_at, v.object_key, v.manifest_json
    FROM skills s JOIN users u ON u.id = s.owner_id
    JOIN skill_versions v ON v.id = s.current_version_id
    WHERE v.status = 'published' AND (s.visibility = 'public' OR s.organization_id = ?)
    ORDER BY v.published_at DESC LIMIT 200`).bind(organizationId ?? null).all<PublishedRow>()
  return (result.results ?? []).map(row => publishedRowSummary(
    row,
    JSON.parse(row.manifest_json) as StoryflowSkillManifest,
    downloadCounts.get(row.slug) ?? 0,
  ))
}

async function loadPublishedRow(
  slug: string,
  version: string | undefined,
  env: Env,
  organizationId?: string,
): Promise<PublishedRow | null> {
  if (!env.DB) return null
  const versionClause = version ? 'AND v.version = ?' : 'AND v.id = s.current_version_id'
  const statement = env.DB.prepare(`SELECT s.owner_id, u.display_name AS publisher_name,
    s.visibility, s.organization_id,
    s.slug, v.version, s.display_name, s.summary, s.license,
    s.tags_json, v.sha256, v.published_at, v.object_key, v.manifest_json
    FROM skills s JOIN users u ON u.id = s.owner_id
    JOIN skill_versions v ON v.skill_id = s.id
    WHERE s.slug = ? AND v.status = 'published'
      AND (s.visibility = 'public' OR s.organization_id = ?) ${versionClause}`)
  return version
    ? statement.bind(slug, organizationId ?? null, version).first<PublishedRow>()
    : statement.bind(slug, organizationId ?? null).first<PublishedRow>()
}

function publishedRowSummary(
  row: PublishedRow,
  manifest: StoryflowSkillManifest,
  downloadCount: number,
): MarketSkillSummary {
  return {
    slug: row.slug, version: row.version, displayName: row.display_name, summary: row.summary,
    author: manifest.author.name,
    publisher: { id: row.owner_id, displayName: row.publisher_name ?? 'Storyflow member' },
    visibility: row.visibility,
    license: row.license, tags: JSON.parse(row.tags_json) as string[],
    roots: manifest.contributes?.projectLayout?.roots.map(root => root.path) ?? [],
    downloadCount, publishedAt: row.published_at, sha256: row.sha256,
  }
}

function sortMarketSkills(skills: MarketSkillSummary[]): MarketSkillSummary[] {
  return [...skills].sort((left, right) => (
    (left.recommendation?.order ?? Number.MAX_SAFE_INTEGER)
      - (right.recommendation?.order ?? Number.MAX_SAFE_INTEGER)
    || right.downloadCount - left.downloadCount
    || (right.publishedAt ?? '').localeCompare(left.publishedAt ?? '')
    || left.slug.localeCompare(right.slug)
  ))
}

async function loadDownloadCounts(env: Env): Promise<Map<string, number>> {
  if (!env.DB) return new Map()
  const result = await env.DB.prepare('SELECT slug, download_count FROM skill_metrics').all<SkillMetricRow>()
  return new Map((result.results ?? []).map(row => [row.slug, row.download_count]))
}

async function loadDownloadCount(env: Env, slug: string): Promise<number> {
  if (!env.DB) return 0
  const row = await env.DB.prepare('SELECT download_count FROM skill_metrics WHERE slug = ?')
    .bind(slug)
    .first<Pick<SkillMetricRow, 'download_count'>>()
  return row?.download_count ?? 0
}

async function recordDownload(env: Env, slug: string): Promise<void> {
  if (!env.DB) return
  const now = new Date().toISOString()
  try {
    await env.DB.prepare(`INSERT INTO skill_metrics (slug, download_count, updated_at)
      VALUES (?, 1, ?) ON CONFLICT(slug) DO UPDATE SET
      download_count = download_count + 1, updated_at = excluded.updated_at`)
      .bind(slug, now)
      .run()
  } catch (error) {
    console.error('[skills-market] Failed to record download', { slug, error })
  }
}

async function readMarketIdentity(
  request: Request,
  env: Env,
  requiredScope: 'skills:read' | 'skills:publish',
  required: boolean,
): Promise<PublisherIdentity | null> {
  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) {
    if (required) throw new RequestError(401, 'Skills Market publish token required')
    return null
  }

  const currentKey = readMarketVerificationKey(
    env.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID,
    env.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET,
  )
  if (!currentKey) throw new RequestError(503, 'Skills Market identity verification is not configured')
  try {
    const kid = decodeProtectedHeader(token).kid
    const previousKey = readMarketVerificationKey(
      env.STORYFLOW_SKILLS_MARKET_JWT_PREVIOUS_KEY_ID,
      env.STORYFLOW_SKILLS_MARKET_JWT_PREVIOUS_SECRET,
    )
    const key = kid === currentKey.id ? currentKey : previousKey?.id === kid ? previousKey : null
    if (!key) throw new Error('unknown key')
    const { payload } = await jwtVerify(token, new TextEncoder().encode(key.secret), {
      algorithms: ['HS256'],
      issuer: 'storyflow-auth-broker',
      audience: 'storyflow-skills-market',
      requiredClaims: ['sub', 'iat', 'exp'],
      clockTolerance: 0,
    })
    if (
      typeof payload.sub !== 'string'
      || !payload.sub.trim()
      || !Array.isArray(payload.scopes)
      || !payload.scopes.includes(requiredScope)
    ) throw new Error('invalid capability')
    return {
      subject: payload.sub,
      ...(typeof payload.user_name === 'string' ? { name: payload.user_name } : {}),
      ...(typeof payload.organization_id === 'string' ? { organizationId: payload.organization_id } : {}),
    }
  } catch {
    throw new RequestError(401, 'Invalid Skills Market publish token')
  }
}

function readMarketVerificationKey(id: string | undefined, secret: string | undefined): { id: string, secret: string } | null {
  const normalizedId = id?.trim()
  const normalizedSecret = secret?.trim()
  return normalizedId && normalizedSecret ? { id: normalizedId, secret: normalizedSecret } : null
}

function readBearerToken(value: string | null): string | null {
  const match = value?.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1] ?? null
}

async function readBoundedSubmission(request: Request): Promise<string> {
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > 7 * 1024 * 1024) throw new RequestError(413, 'Submission exceeds 7 MB request limit')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new RequestError(400, 'Submission must be UTF-8 JSON')
  }
}

async function digestText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function bundleResponse(
  raw: string,
  sha256: string,
  filename: string,
  headOnly = false,
  privateCache = false,
): Response {
  return withCors(new Response(headOnly ? null : raw, {
    headers: {
      'content-type': 'application/vnd.storyflow.skill+json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': privateCache ? PRIVATE_CACHE : 'public, max-age=31536000, immutable',
      etag: `"sha256-${sha256}"`,
      'x-content-sha256': sha256,
    },
  }))
}

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return withCors(new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } }))
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  headers.set('access-control-allow-headers', 'authorization, content-type')
  headers.set('access-control-expose-headers', 'etag, x-content-sha256')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
