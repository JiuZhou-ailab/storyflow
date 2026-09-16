// input: Bundled Workers, signed credentials, real D1 and Service Bindings
// output: HTTP acceptance assertions under Miniflare's supported Node runtime
// pos: Native Worker portion of the managed-access Bun test
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SignJWT, generateKeyPair, exportJWK, exportPKCS8, exportSPKI, decodeJwt, jwtVerify } from 'jose'
import { Miniflare, type MiniflareOptions } from 'miniflare'
import { accessChange } from './access-state'
import { handleRequest as gatewayRequest } from '../../model-gateway-worker/src/index'
const root = process.argv[2]!
const bundles = process.argv[3]!
const bundle = (name: string) => readFile(join(bundles, name + '.js'), 'utf8')
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = await exportJWK(publicKey)
const token = await new SignJWT({ email: 'rpc@example.com', emailVerified: true })
  .setProtectedHeader({ alg: 'RS256' }).setSubject('rpc-user').setIssuer('https://identity.test')
  .setAudience('https://identity.test').setIssuedAt().setExpirationTime('1h').sign(privateKey)
const toolKeys = await generateKeyPair('ES256', { extractable: true })
const toolPrivate = await exportPKCS8(toolKeys.privateKey)
const toolPublic = await exportSPKI(toolKeys.publicKey)
let upstreamCalls = 0
let toolCalls = 0
let identityBarrier: (() => Promise<void>) | undefined
const options: MiniflareOptions = { d1Persist: join(bundles, 'd1'), workers: [
  { name: 'broker', modules: true, script: await bundle('broker'), compatibilityDate: '2026-05-28',
    d1Databases: { ACCESS_DB: 'access' },
    bindings: { STORYFLOW_ACCESS_ENFORCEMENT: 'required', CRAFT_WEBUI_NEON_AUTH_BASE_URL: 'https://identity.test',
      STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: 'identity-test-secret', STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: 'model-test-secret',
      STORYFLOW_TOOL_GATEWAY_JWT_PRIVATE_KEY: toolPrivate, STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: 'market-test-key' },
    outboundService: async () => { await identityBarrier?.(); return Response.json({ keys: [jwk] }) },
  },
  { name: 'model', modules: true, script: await bundle('model'), compatibilityDate: '2026-05-28',
    bindings: { STORYFLOW_ACCESS_ENFORCEMENT: 'required', STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: 'model-test-secret',
      NEWAPI_API_KEY: 'server-test-key', NEWAPI_UPSTREAM_BASE_URL: 'https://upstream.test' },
    serviceBindings: { ACCESS_AUTHORITY: { name: 'broker', entrypoint: 'AccessAuthority' } },
    outboundService: () => { upstreamCalls++; return Response.json({ data: [{ id: 'gpt-5.5' }, { id: 'deepseek-v4-flash' }] }) },
  },
  { name: 'tools', modules: true, script: await bundle('tools'), compatibilityDate: '2026-05-28',
    bindings: { STORYFLOW_ACCESS_ENFORCEMENT: 'required', STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_PUBLIC_KEY: toolPublic,
      ANYSEARCH_API_KEY: 'search-test-key', FIRECRAWL_API_KEY: 'scrape-test-key' },
    serviceBindings: { ACCESS_AUTHORITY: { name: 'broker', entrypoint: 'AccessAuthority' } },
    ratelimits: { SEARCH_RATE_LIMITER: { namespace_id: '1', simple: { limit: 60, period: 60 } }, SCRAPE_RATE_LIMITER: { namespace_id: '2', simple: { limit: 10, period: 60 } } },
    outboundService: () => { toolCalls++; return Response.json({ result: { content: [{ type: 'text', text: 'Search results' }] } }) },
  },
] }
let mf = new Miniflare(options)
try {
  let db = await mf.getD1Database('ACCESS_DB', 'broker')
  const sql = await readFile(join(root, 'migrations/0001_managed_access.sql'), 'utf8')
  await db.batch(sql.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)))
  const auditSql = await readFile(join(root, 'migrations/0002_access_audit.sql'), 'utf8')
  await db.batch(auditSql.split('-- statement').map(sql => db.prepare(sql)))
  let broker = { fetch: mf.dispatchFetch.bind(mf) }
  let model = await mf.getWorker('model')
  let tools = await mf.getWorker('tools')
  const admin = async (operation: string, target: string, value?: string) => {
    const change = accessChange(operation, target, 'test-operator', value)
    await db.prepare(change.sql).bind(...change.params).run()
  }
  const login = await broker.fetch('https://auth.test/api/client-auth/neon/exchange', { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(login.status, 200)
  const session = await login.json() as { appSessionToken: string; modelAccessToken: string }
  let currentModelToken = session.modelAccessToken
  const request = () => model.fetch('https://model.test/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${currentModelToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-5.5', input: 'test' }) })
  assert.ok('data' in (await (await request()).json() as object))
  const toolResponse = await broker.fetch('https://auth.test/api/client-auth/tools/token', { method: 'POST', headers: { Authorization: `Bearer ${session.appSessionToken}` } })
  assert.equal(toolResponse.status, 200)
  const toolToken = (await toolResponse.json() as { toolAccessToken: string }).toolAccessToken
  const search = () => tools.fetch('https://tools.test/v1/search', { method: 'POST', headers: { Authorization: `Bearer ${toolToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'test' }) })
  assert.ok('results' in (await (await search()).json() as object))
  await admin('models', 'neon:rpc-user', 'deepseek-v4-flash')
  assert.equal((await (await request()).json() as { reason: string }).reason, 'model_denied')
  const catalog = await model.fetch('https://model.test/v1/models', { headers: { Authorization: `Bearer ${currentModelToken}` } })
  assert.deepEqual((await catalog.json() as { data: { id: string }[] }).data.map(model => model.id), ['deepseek-v4-flash'])
  const callsBeforeRevoke = upstreamCalls
  const revoke = await broker.fetch('https://auth.test/api/client-auth/session/revoke', { method: 'POST', headers: { Authorization: `Bearer ${session.appSessionToken}` } })
  assert.equal(revoke.status, 204)
  assert.equal((await (await request()).json() as { reason: string }).reason, 'session_revoked')
  assert.equal(upstreamCalls, callsBeforeRevoke)
  assert.equal((await (await search()).json() as { reason: string }).reason, 'session_revoked')
  assert.equal(toolCalls, 1)
  // A fresh login preserves restrictions; disabling also irreversibly revokes all existing sessions.
  const nextLogin = await broker.fetch('https://auth.test/api/client-auth/neon/exchange', { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } })
  const next = await nextLogin.json() as { appSessionToken: string; modelAccessToken: string }
  currentModelToken = next.modelAccessToken
  assert.equal((await (await request()).json() as { reason: string }).reason, 'model_denied')
  const market = await (await broker.fetch('https://auth.test/api/client-auth/skills-market/token', { method: 'POST', headers: { Authorization: `Bearer ${next.appSessionToken}` } })).json() as { marketPublishToken: string }
  const marketClaims = decodeJwt(market.marketPublishToken)
  assert.equal(marketClaims.exp! - marketClaims.iat!, 300)
  // Hold a genuine provider exchange until disabling has committed.
  let releaseIdentity!: () => void
  let observedIdentity!: () => void
  const observed = new Promise<void>(resolve => { observedIdentity = resolve })
  const released = new Promise<void>(resolve => { releaseIdentity = resolve })
  identityBarrier = () => { observedIdentity(); return released }
  const concurrentLogin = broker.fetch('https://auth.test/api/client-auth/neon/exchange', { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } })
  await observed
  await admin('disable', 'neon:rpc-user')
  releaseIdentity()
  assert.equal((await concurrentLogin).status, 403)
  identityBarrier = undefined
  // Registry's already-issued token remains cryptographically valid for its documented 300 seconds.
  await jwtVerify(market.marketPublishToken, new TextEncoder().encode('market-test-key'), { issuer: 'storyflow-auth-broker', audience: 'storyflow-skills-market' })
  assert.equal((await (await request()).json() as { reason: string }).reason, 'account_disabled')
  const deniedMarket = await broker.fetch('https://auth.test/api/client-auth/skills-market/token', { method: 'POST', headers: { Authorization: `Bearer ${next.appSessionToken}` } })
  assert.equal(deniedMarket.status, 403)
  await admin('enable', 'neon:rpc-user')
  assert.equal((await (await request()).json() as { reason: string }).reason, 'session_revoked')
  // New rights cannot enlarge the scope ceiling of a previously minted token.
  await admin('models', 'neon:rpc-user', 'all')
  await admin('scopes', 'neon:rpc-user', 'catalog:read')
  const limited = await (await broker.fetch('https://auth.test/api/client-auth/neon/exchange', { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } })).json() as typeof session
  currentModelToken = limited.modelAccessToken
  assert.deepEqual(decodeJwt(currentModelToken).scopes, ['catalog:read'])
  assert.equal((await model.fetch('https://model.test/v1/models', { headers: { Authorization: `Bearer ${currentModelToken}` } })).status, 200)
  await admin('scopes', 'neon:rpc-user', 'model:chat,catalog:read,web:search')
  assert.equal((await (await request()).json() as { reason: string }).reason, 'scope_denied')
  const refresh = await broker.fetch('https://auth.test/api/client-auth/token', { method: 'POST', headers: { Authorization: `Bearer ${limited.appSessionToken}` } })
  const renewed = await refresh.json() as typeof session
  assert.equal(decodeJwt(renewed.appSessionToken).sid, decodeJwt(limited.appSessionToken).sid)
  assert.equal(decodeJwt(renewed.appSessionToken).exp, decodeJwt(limited.appSessionToken).exp)
  currentModelToken = renewed.modelAccessToken
  assert.equal((await request()).status, 200)
  await admin('scopes', 'neon:rpc-user', 'catalog:read,web:search')
  assert.equal((await (await request()).json() as { reason: string }).reason, 'scope_denied')
  await admin('scopes', 'neon:rpc-user', 'model:chat,catalog:read,web:search')
  // Delay reading a completed refresh until revoke-all commits: the late capability cannot regain access.
  const late = await broker.fetch('https://auth.test/api/client-auth/token', { method: 'POST', headers: { Authorization: `Bearer ${renewed.appSessionToken}` } })
  await admin('revoke-all', 'neon:rpc-user')
  currentModelToken = (await late.json() as typeof session).modelAccessToken
  assert.equal((await (await request()).json() as { reason: string }).reason, 'session_revoked')
  const revokedToken = currentModelToken
  const fresh = await (await broker.fetch('https://auth.test/api/client-auth/neon/exchange', { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } })).json() as typeof session
  // A real Worker process restart uses the same on-disk D1; rotate keys while retaining the previous key.
  const brokerBindings = options.workers[0]!.bindings!
  brokerBindings.STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_KEY_ID = 'current'
  brokerBindings.STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_SECRET = 'identity-test-secret'
  brokerBindings.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID = 'rotated-identity'
  brokerBindings.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET = 'rotated-identity-secret'
  await mf.dispose()
  mf = new Miniflare(options)
  db = await mf.getD1Database('ACCESS_DB', 'broker')
  broker = { fetch: mf.dispatchFetch.bind(mf) }
  model = await mf.getWorker('model')
  tools = await mf.getWorker('tools')
  assert.equal((await (await request()).json() as { reason: string }).reason, 'session_revoked')
  const afterRestart = await broker.fetch('https://auth.test/api/client-auth/token', { method: 'POST', headers: { Authorization: `Bearer ${fresh.appSessionToken}` } })
  assert.equal(afterRestart.status, 200)
  currentModelToken = (await afterRestart.json() as typeof session).modelAccessToken
  assert.equal((await request()).status, 200)
  // Missing records, a mismatched subject, unknown keys, signatures and expiry have safe diagnostics.
  const claims = decodeJwt(currentModelToken)
  const signedModel = (patch: object, key = 'model-test-secret', kid = 'current') => new SignJWT({ ...claims, ...patch }).setProtectedHeader({ alg: 'HS256', kid }).sign(new TextEncoder().encode(key))
  for (const [badToken, reason] of [
    [await signedModel({ sid: 'missing' }), 'session_revoked'],
    [await signedModel({ sub: 'neon:someone-else' }), 'session_revoked'],
    [await signedModel({ exp: Math.floor(Date.now() / 1000) - 1 }), 'token_expired'],
    [await signedModel({}, 'incorrect-secret'), 'invalid_token'],
    [await signedModel({}, 'model-test-secret', 'unknown-key'), 'unknown_signing_key'],
    [await signedModel({ sid: undefined }), 'legacy_session'],
    ['', 'token_missing'],
  ]) {
    currentModelToken = badToken!
    const response = await request()
    assert.equal(response.status, 401)
    const diagnostic = await response.json() as { reason: string; correlation_id: string }
    assert.equal(diagnostic.reason, reason)
    assert.match(diagnostic.correlation_id, /^[a-f0-9-]{36}$/)
  }
  currentModelToken = fresh.modelAccessToken
  await admin('scopes', 'neon:rpc-user', 'model:chat')
  assert.equal((await model.fetch('https://model.test/v1/models', { headers: { Authorization: `Bearer ${currentModelToken}` } })).status, 403)
  await admin('scopes', 'neon:rpc-user', 'model:chat,catalog:read,web:search')
  const beforeOutage = upstreamCalls
  const beforeToolOutage = toolCalls
  // A missing state table exercises the actual RPC failure path, not a stubbed allow/deny service.
  await db.prepare('ALTER TABLE access_accounts RENAME TO access_accounts_unavailable').run()
  const unavailable = await request()
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json() as { reason: string }).reason, 'dependency_unavailable')
  assert.equal((await search()).status, 503)
  assert.equal(upstreamCalls, beforeOutage)
  assert.equal(toolCalls, beforeToolOutage)
  const missingBinding = await gatewayRequest(new Request('https://model.test/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${revokedToken}` }, body: JSON.stringify({ model: 'gpt-5.5' }) }), { STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: 'model-test-secret', STORYFLOW_ACCESS_ENFORCEMENT: 'required' })
  assert.equal(missingBinding.status, 503)
  const audit = await db.prepare('SELECT actor, operation, result FROM access_audit').all()
  assert.ok(audit.results.some(row => row.actor === 'test-operator' && row.operation === 'account_disabled' && row.result === 'applied'))

} finally { await mf.dispose() }
