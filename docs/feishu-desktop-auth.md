# Desktop Auth and Model Access

Storyflow keeps identity login, product sessions, and upstream model credentials
as separate trust boundaries:

```text
desktop login
  -> auth broker verifies Feishu or Neon identity
  -> auth broker assigns model_tier and signs modelAccessToken
  -> desktop stores that token for the hidden managed connection
  -> model gateway validates the token
  -> model gateway injects the server-only NewAPI key
  -> NewAPI
```

Feishu users receive `model_tier=pro`. Neon email users receive
`model_tier=standard`. Both tiers currently have the same model access; the
claim is already separate so future policy changes stay inside the model
gateway.

The desktop app must never contain the Feishu app secret, the model-token
signing secret, or the NewAPI key.

## Feishu OAuth

The desktop Feishu flow is:

1. The desktop asks `CRAFT_CLIENT_AUTH_BROKER_URL` for public Feishu OAuth config.
2. It opens Feishu authorization with PKCE.
3. Feishu redirects to the loopback callback.
4. The desktop sends the code and verifier to the broker.
5. The broker exchanges the code with its server-only Feishu secret.
6. The broker checks the company tenant allowlist and returns the user plus a
   `pro` model access token.

Add this redirect URL to the Feishu Open Platform application:

```text
http://localhost:6477/callback
```

Production should use:

```dotenv
CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS=false
CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS=tenant_key_a,tenant_key_b
```

## Email Login

The desktop first verifies email/password with Neon Auth, then sends the Neon
token to the same auth broker. The broker verifies the JWT against Neon JWKS
and returns a `standard` model access token.

Email sign-in and registration are independent switches:

```dotenv
CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED=false
CRAFT_WEBUI_NEON_AUTH_SIGN_UP_ENABLED=false
```

Enable registration only after the Neon project has the intended email
verification and delivery policy.

## Model Gateway

The bundled managed connection points to:

```text
https://storyflow-model.zjding.com/v1
```

Only these public routes exist:

```text
GET  /health
POST /v1/chat/completions
```

For chat calls, the Worker validates the HS256 token signature, issuer,
audience, expiry, subject, `model:chat` scope, and `model_tier`. It then replaces
the client authorization header with its server-only `NEWAPI_API_KEY` and
forwards the request to `NEWAPI_UPSTREAM_BASE_URL`.

The MVP deliberately uses one NewAPI key and one upstream for both roles. Add
per-tier model allowlists only when Standard and Pro actually diverge; add
per-user NewAPI keys only when upstream accounting or revocation requires them.

The active managed endpoint uses OpenAI-compatible Chat Completions
(`customEndpoint.api=openai-completions`).

## Local Development

The built-in local broker can issue model tokens with the local server secret:

```dotenv
CRAFT_CLIENT_AUTH_REQUIRED=true
CRAFT_CLIENT_AUTH_BROKER_URL=http://localhost:9100
CRAFT_CLIENT_FEISHU_APP_ID=cli_xxx
CRAFT_WEBUI_FEISHU_APP_ID=cli_xxx
CRAFT_WEBUI_FEISHU_APP_SECRET=server-only-secret
CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS=true
STORYFLOW_GATEWAY_JWT_SECRET=replace-with-a-long-random-local-secret
```

`bun run electron:dev` starts the local broker automatically when the broker URL
is localhost and no broker is healthy. `STORYFLOW_GATEWAY_JWT_SECRET` is
optional for login-only local development; when omitted, the broker reuses
`CRAFT_SERVER_TOKEN`. Set it explicitly when a local model gateway must verify
the same token.

## Production Deployment

Packaged Electron builds contain public bootstrap values only:

```dotenv
CRAFT_CLIENT_AUTH_REQUIRED=true
CRAFT_CLIENT_AUTH_BROKER_URL=https://storyflow-auth.zjding.com
CRAFT_CLIENT_FEISHU_APP_ID=cli_xxx
CRAFT_CLIENT_NEON_AUTH_BASE_URL=https://your-neon-auth.example.com/neondb/auth
```

Set the same strong random signing secret on both Workers:

```bash
cd apps/auth-broker-worker
bunx wrangler secret put STORYFLOW_GATEWAY_JWT_SECRET
bunx wrangler deploy

cd ../model-gateway-worker
bunx wrangler secret put STORYFLOW_GATEWAY_JWT_SECRET
bunx wrangler secret put NEWAPI_API_KEY
bunx wrangler deploy
```

The model gateway upstream URL is a non-secret Worker variable in
`apps/model-gateway-worker/wrangler.toml`. Rotate any upstream key that has ever
been pasted into chat, logs, or source before deployment.

Minimal smoke checks:

```bash
curl -i https://storyflow-auth.zjding.com/health
curl -i https://storyflow-model.zjding.com/health
curl -i -X POST https://storyflow-model.zjding.com/v1/chat/completions
```

The final request must return `401` without a model access token. A successful
end-to-end chat should be verified only after signing in through the desktop
client.

## Runtime Broker Override

If an installed build has a bad broker URL, add `client-auth.json` to the
Electron user data directory:

```json
{ "authBrokerUrl": "https://storyflow-auth.zjding.com" }
```

The override wins over packaged defaults.

- macOS: `~/Library/Application Support/Storyflow/client-auth.json`
- Windows: `%APPDATA%/Storyflow/client-auth.json`
- Linux: `~/.config/Storyflow/client-auth.json`
