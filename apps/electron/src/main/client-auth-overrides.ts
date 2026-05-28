// input: User-writable client-auth.json under the Electron userData directory
// output: Environment-style key/value overrides for desktop client auth
// pos: Last-mile recovery channel for users locked out by an unreachable packaged broker

import { readFileSync } from 'node:fs'
import path from 'node:path'

const OVERRIDE_KEY_MAP: Record<string, string> = {
  authBrokerUrl: 'CRAFT_CLIENT_AUTH_BROKER_URL',
}

export interface ClientAuthOverrides {
  filePath: string
  values: Record<string, string>
}

export function readClientAuthOverrides(userDataDir: string): ClientAuthOverrides {
  const filePath = path.join(userDataDir, 'client-auth.json')
  const values: Record<string, string> = {}

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return { filePath, values }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { filePath, values }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { filePath, values }
  }

  const record = parsed as Record<string, unknown>
  for (const [fileKey, envKey] of Object.entries(OVERRIDE_KEY_MAP)) {
    const value = record[fileKey]
    if (typeof value === 'string' && value.trim()) {
      values[envKey] = value.trim()
    }
  }

  return { filePath, values }
}
