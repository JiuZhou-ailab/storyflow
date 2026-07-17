// input: Signed and forged Access assertions plus concurrent Skill submissions
// output: Regression coverage for Worker identity verification and atomic publisher ownership
// pos: Security contract tests for the Skills Market trust and persistence boundaries

import { Database, type SQLQueryBindings } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { STORYFLOW_SKILL_MANIFEST_FILE } from '@craft-agent/shared/skills/marketplace'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { METHODOLOGY_SEEDS } from './catalog.ts'
import { handleRequest, type Env } from './index.ts'
import { buildSeedBundle, validateMarketBundle } from './packages.ts'

const ACCESS_ISSUER = 'https://storyflow-test.cloudflareaccess.com'
const SUBMISSIONS_AUDIENCE = 'skills-submissions-aud'
const ADMIN_AUDIENCE = 'skills-admin-aud'

interface TokenOptions {
  issuer?: string
  audience?: string
  subject?: string
  email?: string
  issuedAt?: number
  notBefore?: number
  expiresAt?: number
  privateKey?: CryptoKey
}

async function createAccessFixture() {
  const trusted = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(trusted.publicKey)
  publicJwk.kid = 'trusted-key'
  const fetchJwks = async () => Response.json({ keys: [publicJwk] })
  const now = Math.floor(Date.now() / 1000)

  return {
    env: {
      ASSETS: { fetch: async () => new Response('asset') },
      ACCESS_TEAM_DOMAIN: ACCESS_ISSUER,
      ACCESS_SUBMISSIONS_AUDIENCE: SUBMISSIONS_AUDIENCE,
      ACCESS_ADMIN_AUDIENCE: ADMIN_AUDIENCE,
    } satisfies Env,
    fetchJwks,
    async token(options: TokenOptions = {}) {
      return new SignJWT({ ...(options.email ? { email: options.email } : {}) })
        .setProtectedHeader({ alg: 'RS256', kid: 'trusted-key' })
        .setIssuer(options.issuer ?? ACCESS_ISSUER)
        .setAudience(options.audience ?? SUBMISSIONS_AUDIENCE)
        .setSubject(options.subject ?? 'access-user')
        .setIssuedAt(options.issuedAt ?? now)
        .setNotBefore(options.notBefore ?? now - 1)
        .setExpirationTime(options.expiresAt ?? now + 300)
        .sign(options.privateKey ?? trusted.privateKey)
    },
  }
}

function authenticatedSubmission(token: string, body = '{}'): Request {
  return new Request('https://market.test/api/submissions', {
    method: 'POST',
    headers: { 'cf-access-jwt-assertion': token },
    body,
  })
}

describe('Cloudflare Access verification', () => {
  test('fails closed when verification configuration is missing', async () => {
    const access = await createAccessFixture()
    const response = await handleRequest(authenticatedSubmission(await access.token()), {
      ASSETS: { fetch: async () => new Response('asset') },
    }, access.fetchJwks)

    expect(response.status).toBe(503)
  })

  test('rejects a forged signature', async () => {
    const access = await createAccessFixture()
    const attacker = await generateKeyPair('RS256')
    const response = await handleRequest(
      authenticatedSubmission(await access.token({ privateKey: attacker.privateKey })),
      access.env,
      access.fetchJwks,
    )

    expect(response.status).toBe(401)
  })

  test('rejects expired and not-yet-valid assertions', async () => {
    const access = await createAccessFixture()
    const now = Math.floor(Date.now() / 1000)
    const [expired, premature] = await Promise.all([
      access.token({ issuedAt: now - 120, notBefore: now - 120, expiresAt: now - 60 }),
      access.token({ issuedAt: now, notBefore: now + 60, expiresAt: now + 300 }),
    ])

    const responses = await Promise.all([
      handleRequest(authenticatedSubmission(expired), access.env, access.fetchJwks),
      handleRequest(authenticatedSubmission(premature), access.env, access.fetchJwks),
    ])
    expect(responses.map(response => response.status)).toEqual([401, 401])
  })

  test('binds each protected route to its own audience', async () => {
    const access = await createAccessFixture()
    const adminToken = await access.token({ audience: ADMIN_AUDIENCE })
    const submissionToken = await access.token({ audience: SUBMISSIONS_AUDIENCE, email: 'admin@example.com' })

    const [submissionWithAdminToken, adminWithSubmissionToken] = await Promise.all([
      handleRequest(authenticatedSubmission(adminToken), access.env, access.fetchJwks),
      handleRequest(new Request('https://market.test/api/admin/versions/v1/publish', {
        method: 'POST',
        headers: { 'cf-access-jwt-assertion': submissionToken },
      }), { ...access.env, ADMIN_EMAILS: 'admin@example.com' }, access.fetchJwks),
    ])

    expect(submissionWithAdminToken.status).toBe(401)
    expect(adminWithSubmissionToken.status).toBe(401)
  })

  test('rejects assertions from a different Access team issuer', async () => {
    const access = await createAccessFixture()
    const token = await access.token({ issuer: 'https://other-team.cloudflareaccess.com' })
    const response = await handleRequest(authenticatedSubmission(token), access.env, access.fetchJwks)

    expect(response.status).toBe(401)
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

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
}

function toSqlBinding(value: unknown): SQLQueryBindings {
  if (value === null || ['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
    return value as SQLQueryBindings
  }
  if (ArrayBuffer.isView(value)) return value as SQLQueryBindings
  throw new Error(`Unsupported SQLite test binding: ${typeof value}`)
}

async function bundleWithVersion(version: string): Promise<string> {
  const seed = METHODOLOGY_SEEDS.find(item => item.distribution === 'installable')
  if (!seed) throw new Error('Installable methodology fixture is missing')
  const built = await buildSeedBundle(seed)
  const bundle = structuredClone(built.bundle)
  const manifestFile = bundle.resources.skills?.[0]?.files.find(file => file.relativePath === STORYFLOW_SKILL_MANIFEST_FILE)
  if (!manifestFile) throw new Error('Manifest fixture is missing')
  const manifest = JSON.parse(new TextDecoder().decode(Uint8Array.from(
    atob(manifestFile.contentBase64),
    character => character.charCodeAt(0),
  ))) as { version: string }
  manifest.version = version
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
    const access = await createAccessFixture()
    const migration = await Bun.file(new URL('../migrations/0001_initial.sql', import.meta.url)).text()
    const d1 = new SqliteD1Database(migration)
    const packages = new MemoryR2Bucket()
    const env: Env = {
      ...access.env,
      DB: d1 as unknown as NonNullable<Env['DB']>,
      PACKAGES: packages as unknown as NonNullable<Env['PACKAGES']>,
    }
    const [firstBundle, secondBundle, firstToken, secondToken] = await Promise.all([
      bundleWithVersion('1.0.0'),
      bundleWithVersion('1.0.1'),
      access.token({ subject: 'publisher-one' }),
      access.token({ subject: 'publisher-two' }),
    ])

    const responses = await Promise.all([
      handleRequest(authenticatedSubmission(firstToken, firstBundle), env, access.fetchJwks),
      handleRequest(authenticatedSubmission(secondToken, secondBundle), env, access.fetchJwks),
    ])

    expect(responses.map(response => response.status).sort()).toEqual([202, 409])
    const skill = d1.database.query('SELECT owner_id FROM skills').get() as { owner_id: string }
    const version = d1.database.query('SELECT submitted_by FROM skill_versions').get() as { submitted_by: string }
    const counts = d1.database.query(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM skills) AS skills,
      (SELECT COUNT(*) FROM skill_versions) AS versions`).get() as { users: number, skills: number, versions: number }
    expect(version.submitted_by).toBe(skill.owner_id)
    expect(counts).toEqual({ users: 1, skills: 1, versions: 1 })
    expect(packages.objects.size).toBe(1)
    d1.database.close()
  })
})
