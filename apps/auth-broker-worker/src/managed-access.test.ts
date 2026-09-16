// input: Public auth requests, real signed tokens, and local Worker persistence
// output: Access and revocation contract regression coverage
// pos: Auth Broker HTTP acceptance seam for managed access
import { expect, test } from 'bun:test'
import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Miniflare } from 'miniflare'
import { handleRequest } from './index'
import { handleRequest as gatewayRequest } from '../../model-gateway-worker/src/index'
import { authorizeAccess } from './access-state'

test('legacy identity cannot mint a new session after access enforcement', async () => {
  const token = await new SignJWT({ scope: 'capability:issue', model_tier: 'standard', auth_time: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: 'HS256', kid: 'current' })
    .setSubject('neon:user').setIssuer('storyflow-auth-broker').setAudience('storyflow-client-auth')
    .setIssuedAt().setExpirationTime('90d').sign(new TextEncoder().encode('identity-test-secret'))
  const response = await handleRequest(new Request('https://auth.test/api/client-auth/token', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  }), {
    STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: 'identity-test-secret',
    STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: 'model-test-secret',
    STORYFLOW_ACCESS_ENFORCEMENT: 'required',
  })
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({ code: 'client_session_token_invalid', reason: 'legacy_session' })
})

test('a signed-in session can be revoked without revoking a second installation', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['ACCESS_DB'] })
  try {
    const db = await mf.getD1Database('ACCESS_DB')
    const sql = await Bun.file(new URL('../migrations/0001_managed_access.sql', import.meta.url)).text()
    await db.batch(sql.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)))
    const auditSql = await Bun.file(new URL('../migrations/0002_access_audit.sql', import.meta.url)).text()
    await db.batch(auditSql.split('-- statement').map(sql => db.prepare(sql)))
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    const identity = await new SignJWT({ email: 'test@example.com', emailVerified: true })
      .setProtectedHeader({ alg: 'RS256' }).setSubject('user').setIssuer('https://identity.test')
      .setAudience('https://identity.test').setIssuedAt().setExpirationTime('1h').sign(privateKey)
    const env = {
      ACCESS_DB: db,
      STORYFLOW_ACCESS_ENFORCEMENT: 'required',
      CRAFT_WEBUI_NEON_AUTH_BASE_URL: 'https://identity.test',
      STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: 'identity-test-secret',
      STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: 'model-test-secret',
    }
    const request = (path: string, token: string) => handleRequest(new Request(`https://auth.test/api/client-auth/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }), env, async () => Response.json({ keys: [jwk] }))
    const first = await (await request('neon/exchange', identity)).json() as { appSessionToken: string; modelAccessToken: string }
    const second = await (await request('neon/exchange', identity)).json() as { appSessionToken: string; modelAccessToken: string }
    let upstreamCalls = 0
    const modelRequest = () => gatewayRequest(new Request('https://model.test/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${first.modelAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5', input: 'test' }),
    }), { ...env, NEWAPI_API_KEY: 'server-test-key', NEWAPI_UPSTREAM_BASE_URL: 'https://upstream.test',
      ACCESS_AUTHORITY: { authorize: (identity, scope, model) => authorizeAccess(env, identity, scope, model) },
    }, async () => { upstreamCalls++; return Response.json({ ok: true }) })
    expect((await modelRequest()).status).toBe(200)
    expect((await request('session/revoke', first.appSessionToken)).status).toBe(204)
    expect((await modelRequest()).status).toBe(401)
    expect(upstreamCalls).toBe(1)
    expect((await request('session/revoke', first.appSessionToken)).status).toBe(204)
    expect((await request('token', first.appSessionToken)).status).toBe(401)
    expect((await request('token', second.appSessionToken)).status).toBe(200)
  } finally { await mf.dispose() }
}, 20000)

test('native Worker bindings enforce policy, revocation and persistence', async () => {
  // Miniflare uses Node/undici. Bun 1.4 resets repeated Worker fetches; run the native seam in Node.
  const directory = await mkdtemp(join(tmpdir(), 'storyflow-access-'))
  try {
    for (const [entry, name] of [ ['./worker.ts', 'broker'], ['../../model-gateway-worker/src/index.ts', 'model'], ['../../tool-gateway-worker/src/index.ts', 'tools'], ['./managed-access.integration.ts', 'acceptance'] ]) {
      const result = await Bun.build({ entrypoints: [new URL(entry!, import.meta.url).pathname], target: name === 'acceptance' ? 'node' : 'browser', external: ['cloudflare:workers'],
        plugins: [{ name: 'native-miniflare', setup(build) { build.onResolve({ filter: /^miniflare$/ }, () => ({ path: import.meta.resolve('miniflare').replace('file://', ''), external: true })) } }],
      })
      if (!result.success) throw new AggregateError(result.logs, 'Worker acceptance bundle failed')
      await Bun.write(join(directory, name + (name === 'acceptance' ? '.mjs' : '.js')), result.outputs[0]!)
    }
    const result = Bun.spawnSync(['node', join(directory, 'acceptance.mjs'), new URL('..', import.meta.url).pathname, directory], { stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) throw new Error(result.stdout.toString() + result.stderr.toString())
    expect(result.exitCode).toBe(0)
    const reads = result.stdout.toString().split('\n').filter(line => line.startsWith('{"event":"managed_access_state_read"')).map(line => JSON.parse(line) as { duration_ms: number; rows_read: number })
    const times = reads.map(read => read.duration_ms).sort((a, b) => a - b)
    expect(reads.length).toBeGreaterThan(0)
    console.log(JSON.stringify({ local_access_reads: reads.length, p50_ms: times[Math.floor(times.length * .5)], p95_ms: times[Math.floor(times.length * .95)], rows_read: reads.reduce((sum, read) => sum + read.rows_read, 0) }))
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)
