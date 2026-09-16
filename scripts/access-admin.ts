// input: Explicit operator intent and existing Cloudflare API credentials
// output: One parameterized D1 access mutation with an atomic database audit
// pos: Operator-only CLI; no public management API or desktop-admin privilege
import { parseArgs } from 'node:util'
import { accessChange } from '../apps/auth-broker-worker/src/access-state'

const { values } = parseArgs({ options: {
  operation: { type: 'string' }, target: { type: 'string' }, value: { type: 'string' },
  database: { type: 'string' }, apply: { type: 'boolean', default: false },
}, strict: true })
const account = process.env.CLOUDFLARE_ACCOUNT_ID
const credential = process.env.CLOUDFLARE_API_TOKEN
if (!account || !/^[a-f0-9]{32}$/i.test(account) || !values.database || !/^[a-f0-9-]{36}$/i.test(values.database)) {
  throw new Error('CLOUDFLARE_ACCOUNT_ID and --database UUID are required')
}
if (!credential) throw new Error('CLOUDFLARE_API_TOKEN is required; credentials never belong in CLI arguments')
async function cloudflare(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  })
  const result = await response.json() as { success?: boolean; result?: unknown }
  if (!response.ok || !result.success) throw new Error(`Cloudflare request failed (${response.status}); access was not confirmed changed`)
  return result.result
}
const identity = await cloudflare('user/tokens/verify') as { id?: string; status?: string }
if (!identity.id || identity.status !== 'active') throw new Error('An active Cloudflare user API token is required')
const change = accessChange(values.operation ?? '', values.target ?? '', `cloudflare-token:${identity.id}`, values.value)
if (!values.apply) {
  console.log(JSON.stringify({ mode: 'preview', operation: values.operation, target: values.target, value: values.value }))
} else {
  const result = await cloudflare(`accounts/${account}/d1/database/${values.database}/query`, change) as { success?: boolean; results?: unknown[] }[]
  if (!Array.isArray(result) || !result[0]?.success) throw new Error('D1 did not confirm the access change')
  console.log(JSON.stringify({ operation: values.operation, affected: result[0].results?.length ?? 0 }))
}
