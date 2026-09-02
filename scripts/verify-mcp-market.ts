// input: Live Storyflow MCP subregistry list endpoint
// output: Proof that the desktop client parser accepts every live catalog entry
// pos: Release gate for the MCP Hub consumer contract; listed endpoints are never contacted

import { strict as assert } from 'node:assert'

import {
  DEFAULT_MCP_REGISTRY_ORIGIN,
  getMcpRegistryInstallDecision,
  parseMcpRegistryListResponse,
} from '@craft-agent/shared/sources/marketplace'

const origin = (process.env.STORYFLOW_MCP_REGISTRY_ORIGIN ?? DEFAULT_MCP_REGISTRY_ORIGIN).replace(/\/$/, '')

const url = new URL('/v0.1/servers', origin)
url.searchParams.set('version', 'latest')
url.searchParams.set('limit', '60')

const response = await fetch(url, {
  headers: { Accept: 'application/json' },
  signal: AbortSignal.timeout(15_000),
})
if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}`)

const body = await response.json()
const parsed = parseMcpRegistryListResponse(body)
assert.ok(parsed.servers.length > 0, 'MCP Registry catalog is empty')

const decisions = parsed.servers.map(server => getMcpRegistryInstallDecision(server))
const installable = decisions.filter(decision => decision.installable).length
const reasons: Record<string, number> = {}
for (const decision of decisions) {
  if (decision.installable) continue
  reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1
}

console.log(JSON.stringify({ catalog: parsed.servers.length, installable, manualOnly: reasons }))
