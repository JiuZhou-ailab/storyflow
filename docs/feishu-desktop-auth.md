# Feishu Desktop Auth

Storyflow desktop uses Feishu OAuth as a public-client flow:

1. The desktop app asks `CRAFT_CLIENT_AUTH_BROKER_URL` for the public Feishu OAuth config.
2. The desktop app opens Feishu's authorize URL with the broker's current app ID.
3. Feishu redirects back to the loopback callback URL on the user's machine.
4. The desktop app sends the code and PKCE verifier to `CRAFT_CLIENT_AUTH_BROKER_URL`.
5. The broker exchanges the code with Feishu using the server-only app secret.
6. If allowed, the broker returns a short-lived managed model gateway JWT and the desktop stores it against every bundled managed gateway connection (`wangsu-default` and `xiaomi-default`).

The desktop app must never include `CRAFT_WEBUI_FEISHU_APP_SECRET`, any Feishu app secret, `CRAFT_CLIENT_GATEWAY_JWT_SECRET`, `CRAFT_CLIENT_GATEWAY_TOKEN`, or the Cloudflare AI Gateway upstream token.

## Feishu Console

Add this redirect URL to the Feishu Open Platform app used for desktop login:

```text
http://localhost:6477/callback
```

The `cli_...` prefix is Feishu's app ID format. If the Feishu login page shows the wrong app name, update `CRAFT_WEBUI_FEISHU_APP_ID` on the auth broker deployment or update the app name in the Feishu Open Platform app. Downloaded desktop clients prefer the broker's public config over any packaged fallback app ID.

## Local Development

Local development can use the built-in dev broker:

```dotenv
CRAFT_CLIENT_AUTH_REQUIRED=true
CRAFT_CLIENT_FEISHU_APP_ID=cli_xxx
CRAFT_CLIENT_AUTH_BROKER_URL=http://localhost:9100
CRAFT_WEBUI_FEISHU_APP_ID=cli_xxx
CRAFT_WEBUI_FEISHU_APP_SECRET=server-only-secret
CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS=true
CRAFT_CLIENT_GATEWAY_JWT_SECRET=local-shared-gateway-secret
CRAFT_CLIENT_GATEWAY_TOKEN_TTL_SECONDS=43200
```

`bun run electron:dev` starts the local broker automatically when the broker URL points at localhost and no broker is already healthy.
`CRAFT_CLIENT_FEISHU_APP_ID` is only a packaged fallback for older brokers that do not expose `/api/client-auth/feishu/config`. The current desktop flow prefers the broker's `CRAFT_WEBUI_FEISHU_APP_ID` at login time.
`CRAFT_CLIENT_GATEWAY_JWT_SECRET` is a broker-only signing secret. Use the same value as `STORYFLOW_GATEWAY_JWT_SECRET` on the model gateway Worker; do not package it into Electron.

For local direct-gateway testing before the Worker is in the request path, the broker can still return `CRAFT_CLIENT_GATEWAY_TOKEN` as a legacy fallback. Do not combine that direct fallback with `CRAFT_CLIENT_GATEWAY_JWT_SECRET`, because Cloudflare AI Gateway will not understand the broker JWT unless the request is routed through the Worker.

## Model Gateway Worker

The recommended production path is:

```text
desktop -> Storyflow model gateway Worker -> Cloudflare AI Gateway custom provider -> upstream model provider
```

Configure the Worker with:

```dotenv
STORYFLOW_GATEWAY_JWT_SECRET=shared-with-auth-broker
STORYFLOW_GATEWAY_JWT_AUDIENCE=storyflow-model-gateway
STORYFLOW_GATEWAY_JWT_ISSUER=storyflow-auth-broker
CLOUDFLARE_AI_GATEWAY_TOKEN=cfut_xxx
WANGSU_UPSTREAM_BASE_URL=https://gateway.ai.cloudflare.com/v1/ec286cbbbae1647af670efd1b3289631/default/custom-wangsu
XIAOMI_UPSTREAM_BASE_URL=https://gateway.ai.cloudflare.com/v1/ec286cbbbae1647af670efd1b3289631/default/custom-xiaomi
```

The Worker routes `/wangsu/*` and `/xiaomi/*` to those upstream bases, accepts the desktop broker JWT from either `Authorization` or `cf-aig-authorization`, removes that incoming client credential, and injects `cf-aig-authorization: Bearer <CLOUDFLARE_AI_GATEWAY_TOKEN>` server-side. This keeps Cloudflare and provider credentials outside the desktop app while still letting Feishu/Neon login issue a local managed-model credential.

The public Wangsu route used by `wangsu-default` is the model gateway Worker route:

```text
https://storyflow-model-gateway.d1095245867.workers.dev/wangsu/v1/17d9ef9735d84a4d37fb44efa49d8148/yewu4
```

Cloudflare appends the SDK path after the gateway route. Keep the Cloudflare custom provider `base_url` at the Wangsu domain root. In direct fallback mode the desktop gateway `baseUrl` carries Wangsu's fixed path prefix; in Worker mode the public `/wangsu/...` route carries that prefix while `WANGSU_UPSTREAM_BASE_URL` ends at `custom-wangsu`:

```text
https://aigateway.edgecloudapp.com
```

The managed Wangsu route exposes `gemini-3.5-flash`, `gpt-5.5`, and `deepseek-v4-pro`; `gpt-5.5` is the default for new sessions.

The public Xiaomi route used by `xiaomi-default` is a separate model gateway Worker route:

```text
https://storyflow-model-gateway.d1095245867.workers.dev/xiaomi/v1
```

It exposes `mimo-v2.5`. Keep Xiaomi separate from Wangsu because Wangsu needs the fixed upstream path prefix in its gateway `baseUrl`, while Xiaomi does not.

The current managed defaults use OpenAI-compatible Chat Completions (`customEndpoint.api = openai-completions`). Do not switch these defaults to Responses API unless each upstream provider accepts Responses-shaped `input` payloads.
For Feishu-authenticated users, keep provider keys behind Cloudflare AI Gateway / Provider Keys. The desktop client receives only the broker JWT; the Worker injects `cf-aig-authorization` server-side and never exposes upstream provider keys.

## Auth Broker Worker

Packaged desktop builds use the deployed HTTPS auth broker:

```text
https://storyflow-auth-broker.d1095245867.workers.dev
```

The auth broker Worker exposes:

```text
GET  /api/client-auth/feishu/config
POST /api/client-auth/feishu/exchange
POST /api/client-auth/neon/exchange
```

Keep Feishu app secrets, Neon Auth verification config, and `CLIENT_GATEWAY_JWT_SECRET` on the Worker. The desktop build only receives public auth bootstrap values.

## Distribution

Packaged builds must use a deployed HTTPS broker:

```dotenv
CRAFT_CLIENT_AUTH_REQUIRED=true
CRAFT_CLIENT_FEISHU_APP_ID=cli_xxx
CRAFT_CLIENT_AUTH_BROKER_URL=https://storyflow-auth-broker.d1095245867.workers.dev
```

The broker environment holds the matching server-only values:

```dotenv
CRAFT_WEBUI_FEISHU_APP_ID=cli_xxx
CRAFT_WEBUI_FEISHU_APP_SECRET=server-only-secret
CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS=tenant_key_a,tenant_key_b
CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS=false
CRAFT_WEBUI_AUTH_DATABASE_URL=postgres://...
CRAFT_CLIENT_GATEWAY_JWT_SECRET=shared-with-model-gateway-worker
CRAFT_CLIENT_GATEWAY_TOKEN_TTL_SECONDS=43200
```

Normal packaged builds fail fast if Feishu client auth points at localhost or a non-HTTPS broker. Use `CRAFT_DEV_RUNTIME=1` only for dev-only builds.
