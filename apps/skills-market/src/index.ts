// input: Public catalog requests, authenticated submissions, Workers AI, D1 metadata, and private R2 packages
// output: Skills Market catalog APIs, immutable bundles, and synchronously reviewed publication
// pos: API-only Cloudflare Worker boundary; the Storyflow desktop app owns presentation and installation

import {
  buildSkillInstallDeepLink,
  type MarketSkillDetail,
  type MarketSkillSummary,
  type StoryflowSkillManifest,
} from '@craft-agent/shared/skills/marketplace'
import { decodeProtectedHeader, jwtVerify } from 'jose'
import { METHODOLOGY_SEEDS, type MethodologySeed } from './catalog.ts'
import { buildSeedBundle, validateMarketBundle } from './packages.ts'
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
}

interface PublisherIdentity {
  subject: string
  name?: string
}

interface PublishedRow {
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

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }))
  if (url.pathname === '/health') return json({ status: 'ok', catalog: METHODOLOGY_SEEDS.length })

  try {
    if (url.pathname === '/api/skills' && request.method === 'GET') return await listSkills(url, env)
    const bundleMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/versions\/([^/]+)\/bundle$/)
    if (bundleMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      return await downloadBundle(
        decodeURIComponent(bundleMatch[1]!),
        decodeURIComponent(bundleMatch[2]!),
        env,
        request.method === 'HEAD',
      )
    }
    const detailMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/)
    if (detailMatch && request.method === 'GET') return await getSkillDetail(decodeURIComponent(detailMatch[1]!), env)
    if (url.pathname === '/api/submissions' && request.method === 'POST') {
      return await submitSkill(request, env)
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500
    return json({ error: error instanceof Error ? error.message : 'Unexpected market error' }, status)
  }

  return json({ error: 'Not found' }, 404)
}

async function listSkills(url: URL, env: Env): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase()
  const tag = (url.searchParams.get('tag') ?? '').trim().toLocaleLowerCase()
  const distribution = url.searchParams.get('distribution')
  const seedSummaries = await Promise.all(METHODOLOGY_SEEDS.map(seedSummary))
  const published = await loadPublishedSummaries(env)
  const bySlug = new Map<string, MarketSkillSummary>(seedSummaries.map(item => [item.slug, item]))
  for (const item of published) bySlug.set(item.slug, item)
  const skills = [...bySlug.values()].filter(skill => {
    if (distribution === 'installable' && !skill.sha256) return false
    if (distribution === 'reference-only' && skill.sha256) return false
    if (tag && !skill.tags.some(value => value.toLocaleLowerCase() === tag)) return false
    if (!query) return true
    return [skill.displayName, skill.summary, skill.author, skill.tags.join(' ')].join(' ').toLocaleLowerCase().includes(query)
  })
  return json({ skills, total: skills.length }, 200, { 'cache-control': PUBLIC_CACHE })
}

async function getSkillDetail(slug: string, env: Env): Promise<Response> {
  const seed = METHODOLOGY_SEEDS.find(item => item.slug === slug)
  if (seed) {
    const detail = await seedDetail(seed)
    return json(detail, 200, { 'cache-control': PUBLIC_CACHE })
  }
  const row = await loadPublishedRow(slug, undefined, env)
  if (!row) throw new RequestError(404, 'Skill not found')
  const packageObject = await env.PACKAGES?.get(row.object_key)
  if (!packageObject) throw new RequestError(503, 'Published package bytes are unavailable')
  const validated = await validateMarketBundle(await new Response(packageObject.body).text())
  const summary = publishedRowSummary(row, validated.manifest)
  const detail: MarketSkillDetail = {
    ...summary,
    skillMarkdown: validated.skillMarkdown,
    manifest: validated.manifest,
    downloadPath: `/api/skills/${encodeURIComponent(row.slug)}/versions/${encodeURIComponent(row.version)}/bundle`,
    installUrl: buildSkillInstallDeepLink(summary),
  }
  return json(detail, 200, { 'cache-control': PUBLIC_CACHE })
}

async function downloadBundle(slug: string, version: string, env: Env, headOnly = false): Promise<Response> {
  const seed = METHODOLOGY_SEEDS.find(item => item.slug === slug)
  if (seed) {
    if (version !== '1.0.0' || seed.distribution !== 'installable') throw new RequestError(404, 'Skill version not found')
    const built = await buildSeedBundle(seed)
    return bundleResponse(built.raw, built.sha256, `${slug}-${version}.storyflow-skill.json`, headOnly)
  }
  const row = await loadPublishedRow(slug, version, env)
  if (!row) throw new RequestError(404, 'Skill version not found')
  const object = await env.PACKAGES?.get(row.object_key)
  if (!object) throw new RequestError(503, 'Published package bytes are unavailable')
  const raw = await new Response(object.body).text()
  return bundleResponse(raw, row.sha256, `${slug}-${version}.storyflow-skill.json`, headOnly)
}

async function submitSkill(request: Request, env: Env): Promise<Response> {
  const identity = await requirePublisherIdentity(request, env)
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
  if (METHODOLOGY_SEEDS.some(seed => seed.slug === validated.manifest.slug)) {
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
      env.DB.prepare(`INSERT INTO skills (id, owner_id, slug, display_name, summary, license, tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET
        display_name=excluded.display_name, summary=excluded.summary, license=excluded.license,
        tags_json=excluded.tags_json, updated_at=excluded.updated_at
        WHERE skills.owner_id=excluded.owner_id`)
        .bind(skillId, userId, validated.manifest.slug, validated.manifest.displayName, validated.manifest.summary,
          validated.manifest.license, JSON.stringify(validated.manifest.tags ?? []), now, now),
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

async function seedSummary(seed: MethodologySeed): Promise<MarketSkillSummary> {
  const built = seed.distribution === 'installable' ? await buildSeedBundle(seed) : null
  return {
    slug: seed.slug,
    version: '1.0.0',
    displayName: seed.displayName,
    summary: seed.summary,
    author: seed.sourceName,
    license: seed.license,
    tags: [...seed.tags, seed.distribution === 'installable' ? '可安装' : '仅参考'],
    roots: [...seed.roots],
    featured: seed.featured,
    publishedAt: '2026-07-17T00:00:00.000Z',
    sha256: built?.sha256 ?? '',
  }
}

async function seedDetail(seed: MethodologySeed): Promise<MarketSkillDetail> {
  const summary = await seedSummary(seed)
  if (seed.distribution === 'installable') {
    const built = await buildSeedBundle(seed)
    return {
      ...summary,
      skillMarkdown: built.skillMarkdown,
      manifest: built.manifest,
      downloadPath: `/api/skills/${encodeURIComponent(seed.slug)}/versions/1.0.0/bundle`,
      installUrl: buildSkillInstallDeepLink(summary),
    }
  }
  const manifest: StoryflowSkillManifest = {
    schemaVersion: 1, slug: seed.slug, version: '1.0.0', displayName: seed.displayName,
    summary: seed.summary, license: seed.license, author: { name: seed.sourceName, url: seed.sourceUrl },
    tags: seed.tags, methodology: { sourceName: seed.sourceName, sourceUrl: seed.sourceUrl, adaptation: 'Reference-only catalog entry.' },
    contributes: { projectLayout: { roots: seed.roots.map((path, order) => ({ path, order })) } },
  }
  return { ...summary, skillMarkdown: '', manifest, downloadPath: '', installUrl: '' }
}

async function loadPublishedSummaries(env: Env): Promise<MarketSkillSummary[]> {
  if (!env.DB) return []
  const result = await env.DB.prepare(`SELECT s.slug, v.version, s.display_name, s.summary, s.license,
    s.tags_json, v.sha256, v.published_at, v.object_key, v.manifest_json
    FROM skills s JOIN skill_versions v ON v.id = s.current_version_id WHERE v.status = 'published'
    ORDER BY v.published_at DESC LIMIT 200`).all<PublishedRow>()
  return (result.results ?? []).map(row => publishedRowSummary(row, JSON.parse(row.manifest_json) as StoryflowSkillManifest))
}

async function loadPublishedRow(slug: string, version: string | undefined, env: Env): Promise<PublishedRow | null> {
  if (!env.DB) return null
  const versionClause = version ? 'AND v.version = ?' : 'AND v.id = s.current_version_id'
  const statement = env.DB.prepare(`SELECT s.slug, v.version, s.display_name, s.summary, s.license,
    s.tags_json, v.sha256, v.published_at, v.object_key, v.manifest_json
    FROM skills s JOIN skill_versions v ON v.skill_id = s.id
    WHERE s.slug = ? AND v.status = 'published' ${versionClause}`)
  return version ? statement.bind(slug, version).first<PublishedRow>() : statement.bind(slug).first<PublishedRow>()
}

function publishedRowSummary(row: PublishedRow, manifest: StoryflowSkillManifest): MarketSkillSummary {
  return {
    slug: row.slug, version: row.version, displayName: row.display_name, summary: row.summary,
    author: manifest.author.name, license: row.license, tags: JSON.parse(row.tags_json) as string[],
    roots: manifest.contributes?.projectLayout?.roots.map(root => root.path) ?? [],
    publishedAt: row.published_at, sha256: row.sha256,
  }
}

async function requirePublisherIdentity(
  request: Request,
  env: Env,
): Promise<PublisherIdentity> {
  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) throw new RequestError(401, 'Skills Market publish token required')

  const keyId = env.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID?.trim()
  const secret = env.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET?.trim()
  if (!keyId || !secret) throw new RequestError(503, 'Skills Market identity verification is not configured')
  try {
    if (decodeProtectedHeader(token).kid !== keyId) throw new Error('unknown key')
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
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
      || !payload.scopes.includes('skills:publish')
    ) throw new Error('invalid capability')
    return {
      subject: payload.sub,
      ...(typeof payload.user_name === 'string' ? { name: payload.user_name } : {}),
    }
  } catch {
    throw new RequestError(401, 'Invalid Skills Market publish token')
  }
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

function bundleResponse(raw: string, sha256: string, filename: string, headOnly = false): Response {
  return withCors(new Response(headOnly ? null : raw, {
    headers: {
      'content-type': 'application/vnd.storyflow.skill+json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'public, max-age=31536000, immutable',
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
