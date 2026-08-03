// input: Signed and forged Market capabilities plus public and company Skill submissions
// output: Regression coverage for identity, visibility, download authorization, and atomic publisher ownership
// pos: Security contract tests for the Skills Market trust and persistence boundaries

import { Database, type SQLQueryBindings } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { STORYFLOW_SKILL_MANIFEST_FILE } from '@craft-agent/shared/skills/marketplace'
import { SignJWT } from 'jose'
import { METHODOLOGY_SEEDS } from './catalog.ts'
import { handleRequest, type Env } from './index.ts'
import { buildSeedBundle, validateMarketBundle } from './packages.ts'

const MARKET_KEY_ID = 'skills-market-test'
const MARKET_SECRET = 'skills-market-secret'

interface TokenOptions {
  issuer?: string
  audience?: string
  subject?: string
  issuedAt?: number
  notBefore?: number
  expiresAt?: number
  keyId?: string
  secret?: string
  scopes?: string[]
  userName?: string
  organizationId?: string
}

const marketEnv = {
  STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID: MARKET_KEY_ID,
  STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: MARKET_SECRET,
} satisfies Env

async function marketToken(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    scopes: options.scopes ?? ['skills:publish'],
    user_name: options.userName ?? 'Market Author',
    ...(options.organizationId ? { organization_id: options.organizationId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: options.keyId ?? MARKET_KEY_ID })
    .setIssuer(options.issuer ?? 'storyflow-auth-broker')
    .setAudience(options.audience ?? 'storyflow-skills-market')
    .setSubject(options.subject ?? 'neon:publisher-one')
    .setIssuedAt(options.issuedAt ?? now)
    .setNotBefore(options.notBefore ?? now - 1)
    .setExpirationTime(options.expiresAt ?? now + 300)
    .sign(new TextEncoder().encode(options.secret ?? MARKET_SECRET))
}

function authenticatedSubmission(token: string, body = '{}'): Request {
  return new Request('https://market.test/api/submissions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  })
}

async function marketSubmission(body: string, options: TokenOptions = {}): Promise<Request> {
  return authenticatedSubmission(await marketToken(options), body)
}

describe('publish capability verification', () => {
  test('does not accept a legacy browser perimeter assertion', async () => {
    const response = await handleRequest(new Request('https://market.test/api/submissions', {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': 'legacy-access-token' },
      body: '{}',
    }), marketEnv)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Skills Market publish token required' })
  })

  test('fails closed when verification configuration is missing', async () => {
    const response = await handleRequest(authenticatedSubmission(await marketToken()), {})

    expect(response.status).toBe(503)
  })

  test('rejects a forged signature', async () => {
    const response = await handleRequest(authenticatedSubmission(await marketToken({ secret: 'attacker-secret' })), marketEnv)

    expect(response.status).toBe(401)
  })

  test('rejects expired and not-yet-valid capabilities', async () => {
    const now = Math.floor(Date.now() / 1000)
    const [expired, premature] = await Promise.all([
      marketToken({ issuedAt: now - 120, notBefore: now - 120, expiresAt: now - 60 }),
      marketToken({ issuedAt: now, notBefore: now + 60, expiresAt: now + 300 }),
    ])

    const responses = await Promise.all([
      handleRequest(authenticatedSubmission(expired), marketEnv),
      handleRequest(authenticatedSubmission(premature), marketEnv),
    ])
    expect(responses.map(response => response.status)).toEqual([401, 401])
  })

  test('binds publication to issuer, audience, key, and scope', async () => {
    const tokens = await Promise.all([
      marketToken({ issuer: 'other-issuer' }),
      marketToken({ audience: 'other-audience' }),
      marketToken({ keyId: 'retired-key' }),
      marketToken({ scopes: ['model:chat'] }),
    ])
    const responses = await Promise.all(tokens.map(token => handleRequest(authenticatedSubmission(token), marketEnv)))
    expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401])
  })
})

class SqliteD1Statement {
  constructor(
    private readonly database: Database,
    private readonly query: string,
    private readonly values: SQLQueryBindings[] = [],
  ) {}

  bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.database, this.query, values.map(toSqlBinding))
  }

  async first<T>(): Promise<T | null> {
    return (this.database.query(this.query).get(...this.values) ?? null) as T | null
  }

  async all<T>(): Promise<{ results: T[], success: boolean }> {
    return { results: this.database.query(this.query).all(...this.values) as T[], success: true }
  }

  async run(): Promise<{ success: boolean }> {
    return this.execute()
  }

  execute(): { success: boolean } {
    this.database.query(this.query).run(...this.values)
    return { success: true }
  }
}

class SqliteD1Database {
  readonly database = new Database(':memory:', { strict: true })

  constructor(migration: string) {
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec(migration)
  }

  prepare(query: string): SqliteD1Statement {
    return new SqliteD1Statement(this.database, query)
  }

  async batch(statements: SqliteD1Statement[]): Promise<Array<{ success: boolean }>> {
    const execute = this.database.transaction((items: SqliteD1Statement[]) => items.map(item => item.execute()))
    return execute(statements)
  }
}

class MemoryR2Bucket {
  readonly objects = new Map<string, string>()

  async put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<void> {
    if (typeof value !== 'string') throw new Error('Test bucket only accepts submission text')
    this.objects.set(key, value)
  }

  async get(key: string): Promise<{ body: string } | null> {
    const body = this.objects.get(key)
    return body === undefined ? null : { body }
  }

}

function toSqlBinding(value: unknown): SQLQueryBindings {
  if (value === null || ['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
    return value as SQLQueryBindings
  }
  if (ArrayBuffer.isView(value)) return value as SQLQueryBindings
  throw new Error(`Unsupported SQLite test binding: ${typeof value}`)
}

async function bundleWithVersion(version: string, slug = 'community-method'): Promise<string> {
  const seed = METHODOLOGY_SEEDS.find(item => item.distribution === 'installable')
  if (!seed) throw new Error('Installable methodology fixture is missing')
  const built = await buildSeedBundle(seed)
  const bundle = structuredClone(built.bundle)
  if (!bundle.resources.skills?.[0]) throw new Error('Skill fixture is missing')
  bundle.resources.skills[0].slug = slug
  const manifestFile = bundle.resources.skills?.[0]?.files.find(file => file.relativePath === STORYFLOW_SKILL_MANIFEST_FILE)
  if (!manifestFile) throw new Error('Manifest fixture is missing')
  const manifest = JSON.parse(new TextDecoder().decode(Uint8Array.from(
    atob(manifestFile.contentBase64),
    character => character.charCodeAt(0),
  ))) as { version: string, slug: string }
  manifest.version = version
  manifest.slug = slug
  const content = `${JSON.stringify(manifest, null, 2)}\n`
  const bytes = new TextEncoder().encode(content)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  manifestFile.contentBase64 = btoa(binary)
  manifestFile.size = bytes.byteLength
  return (await validateMarketBundle(bundle)).raw
}

describe('publisher ownership', () => {
  test('atomically admits one owner and preserves the accepted submitter audit', async () => {
    const migration = [
      await Bun.file(new URL('../migrations/0001_initial.sql', import.meta.url)).text(),
      await Bun.file(new URL('../migrations/0002_ai_review.sql', import.meta.url)).text(),
      await Bun.file(new URL('../migrations/0003_visibility.sql', import.meta.url)).text(),
    ].join('\n')
    const d1 = new SqliteD1Database(migration)
    const packages = new MemoryR2Bucket()
    const env: Env = {
      ...marketEnv,
      DB: d1 as unknown as NonNullable<Env['DB']>,
      PACKAGES: packages as unknown as NonNullable<Env['PACKAGES']>,
      AI: { run: async () => ({ response: JSON.stringify({ approve: true, issues: [] }) }) },
    }
    const [firstBundle, secondBundle, firstToken, secondToken] = await Promise.all([
      bundleWithVersion('1.0.0'),
      bundleWithVersion('1.0.1'),
      marketToken({ subject: 'publisher-one' }),
      marketToken({ subject: 'publisher-two' }),
    ])

    const responses = await Promise.all([
      handleRequest(authenticatedSubmission(firstToken, firstBundle), env),
      handleRequest(authenticatedSubmission(secondToken, secondBundle), env),
    ])

    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    const skill = d1.database.query('SELECT owner_id FROM skills').get() as { owner_id: string }
    const version = d1.database.query('SELECT submitted_by FROM skill_versions').get() as { submitted_by: string }
    const counts = d1.database.query(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM skills) AS skills,
      (SELECT COUNT(*) FROM skill_versions) AS versions`).get() as { users: number, skills: number, versions: number }
    expect(version.submitted_by).toBe(skill.owner_id)
    expect(counts).toEqual({ users: 1, skills: 1, versions: 1 })
    expect(packages.objects.size).toBe(2)
    d1.database.close()
  })

  test('returns the authenticated publisher separately from content attribution', async () => {
    const migration = [
      await Bun.file(new URL('../migrations/0001_initial.sql', import.meta.url)).text(),
      await Bun.file(new URL('../migrations/0002_ai_review.sql', import.meta.url)).text(),
      await Bun.file(new URL('../migrations/0003_visibility.sql', import.meta.url)).text(),
    ].join('\n')
    const d1 = new SqliteD1Database(migration)
    const env: Env = {
      ...marketEnv,
      DB: d1 as unknown as NonNullable<Env['DB']>,
      PACKAGES: new MemoryR2Bucket() as unknown as NonNullable<Env['PACKAGES']>,
      AI: { run: async () => ({ response: JSON.stringify({ approve: true, issues: [] }) }) },
    }
    const bundle = await bundleWithVersion('1.0.0', 'publisher-attribution')
    const token = await marketToken({ subject: 'feishu:writer-one', userName: '张三' })

    const published = await handleRequest(authenticatedSubmission(token, bundle), env)
    const catalog = await handleRequest(new Request('https://market.test/api/skills'), env)
    const body = await catalog.json() as {
      skills: Array<{ slug: string, author: string, publisher: { id: string, displayName: string } }>
    }
    const skill = body.skills.find(item => item.slug === 'publisher-attribution')

    expect(published.status).toBe(201)
    expect(skill?.author).not.toBe('张三')
    expect(skill?.publisher.displayName).toBe('张三')
    expect(skill?.publisher.id).toStartWith('user_')
    d1.database.close()
  })
})

describe('company visibility', () => {
  test('allows only the publisher company to discover and download company Skills', async () => {
    const migration = [
      await Bun.file(new URL('../migrations/0001_initial.sql', import.meta.url)).text(),
      await Bun.file(new URL('../migrations/0002_ai_review.sql', import.meta.url)).text(),
      await Bun.file(new URL('../migrations/0003_visibility.sql', import.meta.url)).text(),
    ].join('\n')
    const d1 = new SqliteD1Database(migration)
    const env: Env = {
      ...marketEnv,
      DB: d1 as unknown as NonNullable<Env['DB']>,
      PACKAGES: new MemoryR2Bucket() as unknown as NonNullable<Env['PACKAGES']>,
      AI: { run: async () => ({ response: JSON.stringify({ approve: true, issues: [] }) }) },
    }
    const bundle = await bundleWithVersion('1.0.0', 'internal-writing-method')
    const [companyToken, otherCompanyToken] = await Promise.all([
      marketToken({
        subject: 'feishu:writer-one',
        userName: '张三',
        organizationId: 'storyflow',
        scopes: ['skills:read', 'skills:publish'],
      }),
      marketToken({
        subject: 'feishu:writer-two',
        userName: '李四',
        organizationId: 'another-company',
        scopes: ['skills:read', 'skills:publish'],
      }),
    ])
    const noCompanyToken = await marketToken({
      subject: 'neon:external-writer',
      scopes: ['skills:read', 'skills:publish'],
    })
    const deniedPublish = await handleRequest(new Request(
      'https://market.test/api/submissions?visibility=company',
      { method: 'POST', headers: { Authorization: `Bearer ${noCompanyToken}` }, body: bundle },
    ), env)
    const publish = await handleRequest(new Request(
      'https://market.test/api/submissions?visibility=company',
      { method: 'POST', headers: { Authorization: `Bearer ${companyToken}` }, body: bundle },
    ), env)

    const anonymousCatalog = await handleRequest(new Request('https://market.test/api/skills'), env)
    const companyCatalog = await handleRequest(new Request('https://market.test/api/skills', {
      headers: { Authorization: `Bearer ${companyToken}` },
    }), env)
    const otherCompanyCatalog = await handleRequest(new Request('https://market.test/api/skills', {
      headers: { Authorization: `Bearer ${otherCompanyToken}` },
    }), env)
    const anonymousBody = await anonymousCatalog.json() as { skills: Array<{ slug: string }> }
    const companyBody = await companyCatalog.json() as { skills: Array<{ slug: string, visibility: string }> }
    const otherCompanyBody = await otherCompanyCatalog.json() as { skills: Array<{ slug: string }> }

    const detailUrl = 'https://market.test/api/skills/internal-writing-method'
    const bundleUrl = `${detailUrl}/versions/1.0.0/bundle`
    const [anonymousDetail, companyDetail, otherCompanyBundle, companyBundle] = await Promise.all([
      handleRequest(new Request(detailUrl), env),
      handleRequest(new Request(detailUrl, { headers: { Authorization: `Bearer ${companyToken}` } }), env),
      handleRequest(new Request(bundleUrl, { headers: { Authorization: `Bearer ${otherCompanyToken}` } }), env),
      handleRequest(new Request(bundleUrl, { headers: { Authorization: `Bearer ${companyToken}` } }), env),
    ])

    expect([deniedPublish.status, publish.status]).toEqual([403, 201])
    expect(anonymousBody.skills.some(skill => skill.slug === 'internal-writing-method')).toBeFalse()
    expect(companyBody.skills.find(skill => skill.slug === 'internal-writing-method')?.visibility).toBe('company')
    expect(otherCompanyBody.skills.some(skill => skill.slug === 'internal-writing-method')).toBeFalse()
    expect([anonymousDetail.status, companyDetail.status, otherCompanyBundle.status, companyBundle.status])
      .toEqual([404, 200, 404, 200])
    d1.database.close()
  })
})

describe('automated publication', () => {
  test('publishes approved bytes and leaves rejected or malformed reviews invisible', async () => {
    const migration = [
      await Bun.file(new URL('../migrations/0001_initial.sql', import.meta.url)).text(),
      await Bun.file(new URL('../migrations/0002_ai_review.sql', import.meta.url)).text(),
      await Bun.file(new URL('../migrations/0003_visibility.sql', import.meta.url)).text(),
    ].join('\n')
    const approvedBundle = await bundleWithVersion('2.0.0')

    const approvedDb = new SqliteD1Database(migration)
    const approvedPackages = new MemoryR2Bucket()
    const approvedEnv: Env = {
      ...marketEnv,
      DB: approvedDb as unknown as NonNullable<Env['DB']>,
      PACKAGES: approvedPackages as unknown as NonNullable<Env['PACKAGES']>,
      AI: { run: async () => ({ response: JSON.stringify({ approve: true, issues: [] }) }) },
    }
    const approved = await handleRequest(await marketSubmission(approvedBundle), approvedEnv)
    const approvedBody = await approved.json() as { slug: string, version: string, sha256: string }
    const detail = await handleRequest(new Request(`https://market.test/api/skills/${approvedBody.slug}`), approvedEnv)
    const download = await handleRequest(new Request(
      `https://market.test/api/skills/${approvedBody.slug}/versions/${approvedBody.version}/bundle`,
    ), approvedEnv)
    expect(approved.status).toBe(201)
    expect(detail.status).toBe(200)
    expect(download.headers.get('x-content-sha256')).toBe(approvedBody.sha256)
    expect(await download.text()).toBe(approvedBundle)
    expect(approvedDb.database.query('SELECT review_json FROM skill_versions').get()).not.toBeNull()

    for (const [responseValue, expectedStatus] of [
      [{ response: JSON.stringify({ approve: false, issues: ['Requests hidden credential access'] }) }, 422],
      [{ response: '{}' }, 503],
    ] as const) {
      const db = new SqliteD1Database(migration)
      const packages = new MemoryR2Bucket()
      const env: Env = {
        ...marketEnv,
        DB: db as unknown as NonNullable<Env['DB']>,
        PACKAGES: packages as unknown as NonNullable<Env['PACKAGES']>,
        AI: { run: async () => responseValue },
      }
      const response = await handleRequest(await marketSubmission(approvedBundle), env)
      expect(response.status).toBe(expectedStatus)
      expect(db.database.query('SELECT COUNT(*) AS count FROM skill_versions').get()).toEqual({ count: 0 })
      expect(packages.objects.size).toBe(0)
      db.database.close()
    }

    const invalidCapability = await handleRequest(
      await marketSubmission(approvedBundle, { scopes: ['model:chat'] }),
      approvedEnv,
    )
    expect(invalidCapability.status).toBe(401)
    approvedDb.database.close()
  })
})
