// input: Loopback broker requests, local capabilities, and mock client-auth state
// output: Regression coverage for zero-config managed CLI credentials
// pos: Guards the desktop boundary that exposes only short-lived user capabilities

import { afterEach, describe, expect, it } from 'bun:test'
import {
  MODEL_ACCESS_BROKER_TOKEN_ENV,
  MODEL_ACCESS_BROKER_URL_ENV,
  startManagedModelCliBroker,
  type ManagedModelCliBroker,
} from '../managed-model-cli-broker'

let broker: ManagedModelCliBroker | null = null

afterEach(async () => {
  await broker?.close()
  broker = null
})

describe('managed model CLI broker', () => {
  it('returns a fresh user capability without exposing the upstream key', async () => {
    const forceValues: boolean[] = []
    broker = await startManagedModelCliBroker({
      gatewayBaseUrl: 'https://storyflow-model.zjding.com/v1',
      isAuthenticated: () => true,
      ensureModelAccessToken: async ({ force } = {}) => {
        forceValues.push(force === true)
        return { token: force ? 'refreshed-user-token' : 'fresh-user-token' }
      },
    })

    const response = await fetch(broker.env[MODEL_ACCESS_BROKER_URL_ENV], {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${broker.env[MODEL_ACCESS_BROKER_TOKEN_ENV]}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ forceRefresh: true }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      gatewayBaseUrl: 'https://storyflow-model.zjding.com',
      modelAccessToken: 'refreshed-user-token',
    })
    expect(forceValues).toEqual([true])
  })

  it('fails closed for invalid local capability and signed-out users', async () => {
    let authenticated = true
    broker = await startManagedModelCliBroker({
      gatewayBaseUrl: 'https://storyflow-model.zjding.com',
      isAuthenticated: () => authenticated,
      ensureModelAccessToken: async () => ({ token: 'must-not-leak' }),
    })
    const url = broker.env[MODEL_ACCESS_BROKER_URL_ENV]

    const invalid = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-capability' },
    })
    authenticated = false
    const signedOut = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.env[MODEL_ACCESS_BROKER_TOKEN_ENV]}` },
    })

    expect(invalid.status).toBe(403)
    expect(await invalid.json()).toMatchObject({ code: 'local_capability_invalid' })
    expect(signedOut.status).toBe(401)
    expect(await signedOut.json()).toMatchObject({ code: 'storyflow_login_required' })
  })
})
