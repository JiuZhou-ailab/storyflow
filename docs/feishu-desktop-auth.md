# Feishu Desktop Auth

Storyflow desktop uses Feishu OAuth as a public-client flow:

1. The desktop app asks `CRAFT_CLIENT_AUTH_BROKER_URL` for the public Feishu OAuth config.
2. The desktop app opens Feishu's authorize URL with the broker's current app ID.
3. Feishu redirects back to the loopback callback URL on the user's machine.
4. The desktop app sends the code and PKCE verifier to `CRAFT_CLIENT_AUTH_BROKER_URL`.
5. The broker exchanges the code with Feishu using the server-only app secret.
6. If allowed, the broker returns the authenticated user identity. Model access is handled by the desktop LLM connection config and is not derived from the login session.

The desktop app must never include `CRAFT_WEBUI_FEISHU_APP_SECRET` or any Feishu app secret. In the simplified model path, `CRAFT_CLIENT_GATEWAY_TOKEN` is a direct Cloudflare AI Gateway credential used to seed the bundled managed LLM connection; it is intentionally separate from login auth.

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
CRAFT_CLIENT_GATEWAY_TOKEN=cfut_xxx
```

`bun run electron:dev` starts the local broker automatically when the broker URL points at localhost and no broker is already healthy.
`CRAFT_CLIENT_FEISHU_APP_ID` is only a packaged fallback for older brokers that do not expose `/api/client-auth/feishu/config`. The current desktop flow prefers the broker's `CRAFT_WEBUI_FEISHU_APP_ID` at login time.
`CRAFT_CLIENT_GATEWAY_TOKEN` seeds the direct Cloudflare AI Gateway credential into the managed model connection. Login success does not write or rotate model credentials.

## Direct Model Gateway

The recommended stability-first production path is:

```text
desktop -> Cloudflare AI Gateway custom provider -> upstream model provider
```

The bundled managed desktop connections use direct Cloudflare AI Gateway base URLs:

```dotenv
CRAFT_CLIENT_GATEWAY_TOKEN=cfut_xxx
```

The direct Wangsu route used by `wangsu-default` is:

```text
https://gateway.ai.cloudflare.com/v1/ec286cbbbae1647af670efd1b3289631/default/custom-wangsu/v1/17d9ef9735d84a4d37fb44efa49d8148/yewu4
```

Cloudflare appends the SDK path after the gateway route. Keep the Cloudflare custom provider `base_url` at the Wangsu domain root:

```text
https://aigateway.edgecloudapp.com
```

The managed Wangsu route exposes `gemini-3.5-flash`, `gpt-5.5`, and `deepseek-v4-pro`. Keep this as the only bundled managed model route for now; do not add a separate Xiaomi route unless Wangsu is deliberately abandoned later.

For Pi-managed calls, keep this connection on `piAuthProvider = cloudflare-ai-gateway`. That provider lets Cloudflare auth travel via `cf-aig-authorization`; sending both `Authorization` and `cf-aig-authorization` can make Wangsu validate the wrong bearer token upstream.

The current managed defaults use OpenAI-compatible Chat Completions (`customEndpoint.api = openai-completions`). Do not switch these defaults to Responses API unless each upstream provider accepts Responses-shaped `input` payloads.
For Feishu-authenticated users, model access remains independent of login. Login decides whether the user can enter the app; the LLM connection decides whether model calls work.

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

Keep Feishu app secrets and Neon Auth verification config on the Worker. The desktop build only receives public auth bootstrap values plus the direct model gateway token used by the bundled managed connection.

## Distribution

Packaged builds must use a deployed HTTPS broker:

```dotenv
CRAFT_CLIENT_AUTH_REQUIRED=true
CRAFT_CLIENT_FEISHU_APP_ID=cli_xxx
CRAFT_CLIENT_AUTH_BROKER_URL=https://storyflow-auth-broker.d1095245867.workers.dev
CRAFT_CLIENT_GATEWAY_TOKEN=cfut_xxx
```

The broker environment holds the matching server-only values:

```dotenv
CRAFT_WEBUI_FEISHU_APP_ID=cli_xxx
CRAFT_WEBUI_FEISHU_APP_SECRET=server-only-secret
CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS=tenant_key_a,tenant_key_b
CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS=false
CRAFT_WEBUI_AUTH_DATABASE_URL=postgres://...
```

Normal packaged builds fail fast if Feishu client auth points at localhost or a non-HTTPS broker. Use `CRAFT_DEV_RUNTIME=1` only for dev-only builds.
