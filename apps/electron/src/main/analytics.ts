// input: POSTHOG_API_KEY / POSTHOG_HOST env vars, anonymous machine ID
// output: singleton PostHog client for main-process event capture
// pos: Thin analytics wrapper mirroring the Sentry pattern — opt-in via env var presence

import { PostHog } from 'posthog-node'

let client: PostHog | null = null

// Distinct ID is an anonymous, stable, per-machine hash (same as Sentry's machineId).
// Set once on init; all subsequent capture calls reuse it.
let distinctId = 'anonymous'

export function initAnalytics(machineId: string): void {
  const apiKey = process.env.POSTHOG_API_KEY
  const host = process.env.POSTHOG_HOST

  if (!apiKey || !host) return

  distinctId = machineId
  client = new PostHog(apiKey, {
    host,
    // Flush synchronously before the process exits — important in Electron
    // because the main process may terminate before async flushes complete.
    flushAt: 20,
    flushInterval: 10_000,
  })
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  client?.capture({ distinctId, event, properties })
}

export async function shutdownAnalytics(): Promise<void> {
  if (client) {
    await client.shutdown()
    client = null
  }
}
