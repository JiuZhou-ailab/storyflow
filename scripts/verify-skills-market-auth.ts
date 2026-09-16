// input: Client-session signing secret plus deployed Auth Broker and Skills Registry origins
// output: Proof that the broker-issued Registry capability is accepted by the live Registry
// pos: Cross-service canary owned by managed-auth deployment, independent of Registry source code

import { SignJWT } from 'jose'

type FetchLike = typeof fetch

interface VerifySkillsMarketAuthOptions {
  clientSessionSecret: string
  appSessionToken?: string
  authOrigin?: string
  marketOrigin?: string
  fetchImpl?: FetchLike
  nowSeconds?: number
}

export async function verifySkillsMarketAuth({
  clientSessionSecret,
  appSessionToken: persistedSession,
  authOrigin = 'https://storyflow-auth.zjding.com',
  marketOrigin = 'https://storyflow-skills.zjding.com',
  fetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifySkillsMarketAuthOptions): Promise<{ catalog: number }> {
  if (!persistedSession && !clientSessionSecret) throw new Error('STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET is required')

  const appSessionToken = persistedSession ?? await new SignJWT({
    scope: 'capability:issue',
    model_tier: 'standard',
    auth_time: nowSeconds,
    user_name: 'Skills Market Canary',
    organization_id: 'skills-market-canary',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: 'client-session-2026-07' })
    .setIssuer('storyflow-auth-broker')
    .setAudience('storyflow-client-auth')
    .setSubject('skills-market-canary')
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 300)
    .sign(new TextEncoder().encode(clientSessionSecret))

  const tokenResponse = await fetchImpl(`${authOrigin.replace(/\/$/, '')}/api/client-auth/skills-market/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${appSessionToken}` },
  })
  if (!tokenResponse.ok) throw new Error(`Auth Broker returned ${tokenResponse.status}: ${await tokenResponse.text()}`)

  const tokenBody = await tokenResponse.json() as { marketPublishToken?: unknown }
  if (typeof tokenBody.marketPublishToken !== 'string') throw new Error('Auth Broker did not return a Market capability')

  const catalogResponse = await fetchImpl(`${marketOrigin.replace(/\/$/, '')}/api/skills`, {
    headers: { Authorization: `Bearer ${tokenBody.marketPublishToken}` },
  })
  if (!catalogResponse.ok) throw new Error(`Skills Market returned ${catalogResponse.status}: ${await catalogResponse.text()}`)

  const catalogBody = await catalogResponse.json() as { skills?: unknown }
  if (!Array.isArray(catalogBody.skills) || catalogBody.skills.length === 0) {
    throw new Error('Authenticated Skills Market catalog is empty')
  }
  return { catalog: catalogBody.skills.length }
}

if (import.meta.main) {
  const appSessionToken = process.env.STORYFLOW_ACCESS_CANARY_SESSION
  const config = Bun.TOML.parse(await Bun.file(new URL('../apps/auth-broker-worker/wrangler.toml', import.meta.url)).text()) as { vars?: { STORYFLOW_ACCESS_ENFORCEMENT?: string } }
  if (config.vars?.STORYFLOW_ACCESS_ENFORCEMENT !== 'legacy' && !appSessionToken) throw new Error('Persisted STORYFLOW_ACCESS_CANARY_SESSION is required')
  const result = await verifySkillsMarketAuth({
    appSessionToken,
    clientSessionSecret: process.env.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET ?? '',
    authOrigin: process.env.STORYFLOW_AUTH_ORIGIN,
    marketOrigin: process.env.STORYFLOW_SKILLS_MARKET_ORIGIN,
  })
  console.log(JSON.stringify(result))
}
