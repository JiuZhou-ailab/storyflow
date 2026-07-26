// input: Auth Broker exchange requests, shared model signing config, and Gateway requests
// output: End-to-end regression coverage for renewable login to NewAPI proxy authorization
// pos: Cross-Worker contract seam preventing issuer, audience, key, and token-class drift

import { describe, expect, it } from 'bun:test'
import { handleRequest as handleAuthBrokerRequest } from '../../auth-broker-worker/src/index'
import { handleRequest as handleModelGatewayRequest } from './index'

const CLIENT_SESSION_SECRET = 'client-session-secret'
const MODEL_ACCESS_SECRET = 'model-access-secret'
const MODEL_ACCESS_KEY_ID = 'model-access-test'

describe('managed auth flow', () => {
  it('accepts only the Broker model capability and keeps the NewAPI key server-side', async () => {
    const exchange = await handleAuthBrokerRequest(
      new Request('https://auth.example.com/api/client-auth/feishu/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'desktop-code',
          redirectUri: 'http://127.0.0.1:6477/callback',
          codeVerifier: 'desktop-verifier',
        }),
      }),
      {
        CRAFT_WEBUI_FEISHU_APP_ID: 'cli_test',
        CRAFT_WEBUI_FEISHU_APP_SECRET: 'feishu-secret',
        CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS: 'true',
        STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID: 'client-session-test',
        STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: CLIENT_SESSION_SECRET,
        STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID: MODEL_ACCESS_KEY_ID,
        STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: MODEL_ACCESS_SECRET,
      },
      async (input) => {
        if (input.toString().endsWith('/open-apis/authen/v2/oauth/token')) {
          return Response.json({ access_token: 'feishu-access-token' })
        }
        if (input.toString().endsWith('/open-apis/authen/v1/user_info')) {
          return Response.json({
            data: {
              open_id: 'ou_test',
              tenant_key: 'tenant_test',
              enterprise_email: 'user@example.com',
            },
          })
        }
        return Response.json({ error: 'unexpected request' }, { status: 500 })
      },
    )

    expect(exchange.status).toBe(200)
    const tokens = await exchange.json() as {
      appSessionToken: string
      modelAccessToken: string
    }

    let upstreamRequest: Request | null = null
    const gatewayEnv = {
      STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID: MODEL_ACCESS_KEY_ID,
      STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: MODEL_ACCESS_SECRET,
      STORYFLOW_GATEWAY_JWT_AUDIENCE: 'storyflow-model-gateway',
      STORYFLOW_GATEWAY_JWT_ISSUER: 'storyflow-auth-broker',
      NEWAPI_API_KEY: 'server-only-newapi-key',
      NEWAPI_UPSTREAM_BASE_URL: 'https://newapi.example.com',
    }
    const accepted = await handleModelGatewayRequest(
      new Request('https://model.example.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.modelAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-5.5', messages: [] }),
      }),
      gatewayEnv,
      async (request) => {
        upstreamRequest = request
        return Response.json({ ok: true })
      },
    )
    const rejectedAppSession = await handleModelGatewayRequest(
      new Request('https://model.example.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.appSessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-5.5', messages: [] }),
      }),
      gatewayEnv,
    )

    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual({ ok: true })
    expect(upstreamRequest?.url).toBe('https://newapi.example.com/v1/chat/completions')
    expect(upstreamRequest?.headers.get('authorization')).toBe('Bearer server-only-newapi-key')
    expect(upstreamRequest?.headers.get('authorization')).not.toContain(tokens.modelAccessToken)
    expect(rejectedAppSession.status).toBe(401)
    expect(await rejectedAppSession.json()).toEqual({
      error: 'Invalid model access token',
      code: 'model_access_token_invalid',
    })
  })
})
