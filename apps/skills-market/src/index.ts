// input: Public catalog requests, Access-authenticated submissions, D1 metadata, and private R2 packages
// output: Skills Market webpage assets, catalog APIs, immutable bundles, and moderated contributions
// pos: Single Cloudflare Worker boundary; it distributes Skills but never executes them

import {
  buildSkillInstallDeepLink,
  type MarketSkillDetail,
  type MarketSkillSummary,
  type StoryflowSkillManifest,
} from '@craft-agent/shared/skills/marketplace'
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import { METHODOLOGY_SEEDS, type MethodologySeed } from './catalog.ts'
import { buildSeedBundle, validateMarketBundle } from './packages.ts'

interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface R2ObjectLike {
  body: BodyInit | ReadableStream<Uint8Array> | null
}

interface R2BucketLike {
  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
  delete(key: string): Promise<void>
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

export interface Env {
  ASSETS: AssetsBinding
  DB?: D1DatabaseLike
  PACKAGES?: R2BucketLike
  MARKET_ORIGIN?: string
  ADMIN_EMAILS?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_SUBMISSIONS_AUDIENCE?: string
  ACCESS_ADMIN_AUDIENCE?: string
}

interface AccessIdentity {
  subject: string
  email?: string
  name?: string
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

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
const accessJwksByFetch = new WeakMap<object, Map<string, ReturnType<typeof createRemoteJWKSet>>>()

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, fetch)
  },
}

export async function handleRequest(
  request: Request,
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
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
      return await submitSkill(request, env, fetchImpl)
    }
    const publishMatch = url.pathname.match(/^\/api\/admin\/versions\/([^/]+)\/publish$/)
    if (publishMatch && request.method === 'POST') {
      return await publishVersion(request, decodeURIComponent(publishMatch[1]!), env, fetchImpl)
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500
    return json({ error: error instanceof Error ? error.message : 'Unexpected market error' }, status)
  }

  return env.ASSETS.fetch(request)
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

async function submitSkill(request: Request, env: Env, fetchImpl: FetchLike): Promise<Response> {
  const identity = await requireAccessIdentity(request, env, env.ACCESS_SUBMISSIONS_AUDIENCE, fetchImpl)
  if (!env.DB || !env.PACKAGES) throw new RequestError(503, 'Contribution storage is not configured')
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 7 * 1024 * 1024) throw new RequestError(413, 'Submission exceeds 7 MB request limit')
  const submitted = await request.text()
  const validated = await validateMarketBundle(submitted)
  const versionId = crypto.randomUUID()
  const skillId = `skill_${validated.manifest.slug}`
  const userId = `user_${(await digestText(identity.subject)).slice(0, 24)}`
  const now = new Date().toISOString()
  const quarantineKey = `quarantine/${versionId}/${validated.sha256}.json`

  await env.PACKAGES.put(quarantineKey, validated.raw, { httpMetadata: { contentType: 'application/json' } })
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (id, access_subject, email, display_name, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(access_subject) DO UPDATE SET email=excluded.email, display_name=excluded.display_name`)
        .bind(userId, identity.subject, identity.email ?? null, identity.name ?? null, now),
      env.DB.prepare(`INSERT INTO skills (id, owner_id, slug, display_name, summary, license, tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET
        display_name=excluded.display_name, summary=excluded.summary, license=excluded.license,
        tags_json=excluded.tags_json, updated_at=excluded.updated_at
        WHERE skills.owner_id=excluded.owner_id`)
        .bind(skillId, userId, validated.manifest.slug, validated.manifest.displayName, validated.manifest.summary,
          validated.manifest.license, JSON.stringify(validated.manifest.tags ?? []), now, now),
      env.DB.prepare(`INSERT INTO skill_versions
        (id, skill_id, submitted_by, version, sha256, object_key, bytes, manifest_json, status, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .bind(versionId, skillId, userId, validated.manifest.version, validated.sha256, quarantineKey,
          validated.bytes, JSON.stringify(validated.manifest), now),
    ])
  } catch (error) {
    await env.PACKAGES.delete(quarantineKey)
    if (error instanceof Error && /FOREIGN KEY/i.test(error.message)) {
      throw new RequestError(409, 'This Skill slug belongs to another publisher')
    }
    if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new RequestError(409, 'This version or package already exists')
    throw error
  }
  return json({ ok: true, versionId, status: 'pending', sha256: validated.sha256 }, 202)
}

async function publishVersion(
  request: Request,
  versionId: string,
  env: Env,
  fetchImpl: FetchLike,
): Promise<Response> {
  const identity = await requireAccessIdentity(request, env, env.ACCESS_ADMIN_AUDIENCE, fetchImpl)
  const admins = new Set((env.ADMIN_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
  if (!identity.email || !admins.has(identity.email.toLowerCase())) throw new RequestError(403, 'Administrator access required')
  if (!env.DB || !env.PACKAGES) throw new RequestError(503, 'Contribution storage is not configured')
  const row = await env.DB.prepare(`SELECT v.id, v.object_key, v.sha256, v.skill_id, v.version
    FROM skill_versions v WHERE v.id = ? AND v.status = 'pending'`).bind(versionId)
    .first<{ id: string, object_key: string, sha256: string, skill_id: string, version: string }>()
  if (!row) throw new RequestError(404, 'Pending version not found')
  const object = await env.PACKAGES.get(row.object_key)
  if (!object) throw new RequestError(409, 'Quarantined package is missing')
  const raw = await new Response(object.body).text()
  const validated = await validateMarketBundle(raw)
  if (validated.sha256 !== row.sha256) throw new RequestError(409, 'Quarantined package checksum changed')
  const publishedKey = `packages/${validated.manifest.slug}/${row.version}/${row.sha256}.json`
  await env.PACKAGES.put(publishedKey, raw, { httpMetadata: { contentType: 'application/json' } })
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(`UPDATE skill_versions SET status='published', object_key=?, published_at=? WHERE id=?`)
      .bind(publishedKey, now, versionId),
    env.DB.prepare('UPDATE skills SET current_version_id=?, updated_at=? WHERE id=?')
      .bind(versionId, now, row.skill_id),
  ])
  await env.PACKAGES.delete(row.object_key)
  return json({ ok: true, status: 'published', slug: validated.manifest.slug, version: row.version, sha256: row.sha256 })
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

async function requireAccessIdentity(
  request: Request,
  env: Env,
  configuredAudience: string | undefined,
  fetchImpl: FetchLike,
): Promise<AccessIdentity> {
  const assertion = request.headers.get('cf-access-jwt-assertion')
  if (!assertion) throw new RequestError(401, 'Cloudflare Access login required')

  const issuer = requireAccessIssuer(env.ACCESS_TEAM_DOMAIN)
  const audience = requireAccessAudience(configuredAudience)
  try {
    const { payload } = await jwtVerify(assertion, accessJwks(issuer, fetchImpl), {
      algorithms: ['RS256'],
      issuer,
      audience,
      requiredClaims: ['sub', 'iat', 'nbf', 'exp'],
      clockTolerance: 0,
    })
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new Error('missing subject')
    return {
      subject: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    }
  } catch {
    throw new RequestError(401, 'Invalid Cloudflare Access identity')
  }
}

function requireAccessIssuer(value: string | undefined): string {
  if (!value?.trim()) throw new RequestError(503, 'Cloudflare Access verification is not configured')
  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:'
      || !url.hostname.endsWith('.cloudflareaccess.com')
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      throw new Error('invalid Access issuer')
    }
    return url.origin
  } catch {
    throw new RequestError(503, 'Cloudflare Access verification is not configured')
  }
}

function requireAccessAudience(value: string | undefined): string[] {
  const audiences = (value ?? '').split(',').map(item => item.trim()).filter(Boolean)
  if (audiences.length === 0) throw new RequestError(503, 'Cloudflare Access verification is not configured')
  return audiences
}

function accessJwks(issuer: string, fetchImpl: FetchLike): ReturnType<typeof createRemoteJWKSet> {
  const fetchKey = fetchImpl as unknown as object
  let byIssuer = accessJwksByFetch.get(fetchKey)
  if (!byIssuer) {
    byIssuer = new Map()
    accessJwksByFetch.set(fetchKey, byIssuer)
  }
  const existing = byIssuer.get(issuer)
  if (existing) return existing
  const jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', `${issuer}/`), {
    [customFetch]: fetchImpl,
  })
  byIssuer.set(issuer, jwks)
  return jwks
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
  headers.set('access-control-allow-methods', 'GET, OPTIONS')
  headers.set('access-control-expose-headers', 'etag, x-content-sha256')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
