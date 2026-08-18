// input: Client-session signing secret plus deployed Auth Broker and Skills Market origins
// output: Proof that the broker-issued Market capability is accepted by the live Market
// pos: Cross-service canary owned by managed-auth deployment, outside desktop product validation

import { SignJWT } from 'jose'

type FetchLike = typeof fetch

interface VerifySkillsMarketAuthOptions {
  clientSessionSecret: string
  authOrigin?: string
  marketOrigin?: string
  fetchImpl?: FetchLike
  nowSeconds?: number
}

export async function verifySkillsMarketAuth({
  clientSessionSecret,
  authOrigin = 'https://storyflow-auth.zjding.com',
  marketOrigin = 'https://storyflow-skills.zjding.com',
  fetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifySkillsMarketAuthOptions): Promise<{ catalog: number }> {
  if (!clientSessionSecret) throw new Error('STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET is required')

  const appSessionToken = await new SignJWT({
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
  const result = await verifySkillsMarketAuth({
    clientSessionSecret: process.env.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET ?? '',
    authOrigin: process.env.STORYFLOW_AUTH_ORIGIN,
    marketOrigin: process.env.STORYFLOW_SKILLS_MARKET_ORIGIN,
  })
  console.log(JSON.stringify(result))
}
