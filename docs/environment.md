# Environment Contract

Storyflow has several environment-variable lifecycles. Treating them as one flat
`.env` surface makes release bugs likely. The stable rule is:

> Variables are grouped by when they are read and whether they can be disclosed.

## Local Development

Local `.env` files are for developer machines only. They may configure local
model credentials, local MCP endpoints, and local auth experiments.

Common local values:

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
CRAFT_MCP_URL=http://localhost:3000/v1/links/YOUR_SECRET_LINK_ID/mcp
CRAFT_MCP_TOKEN=your-bearer-token-here
CRAFT_DEV_RUNTIME=1
```

Local env files are layered without overriding explicit shell or CI variables:

```text
explicit shell/CI env > .env.local > .env.dev > .env
```

`.env.dev` is loaded by `electron:dev` only. Build and release scripts load:

```text
explicit shell/CI env > .env.local > .env
```

Use `.env` for local base values such as 1Password-synced secrets, `.env.local`
for personal overrides, and `.env.dev` for dev-runtime defaults such as a local
auth broker. Do not use local env files as the source of truth for official
release builds. Release builds read GitHub repository vars/secrets.

## Packaged Desktop Build

These values are read while building Electron and are baked into the main
process bundle. Only public client bootstrap values belong here.

GitHub repository vars:

```dotenv
CRAFT_CLIENT_AUTH_BROKER_URL=https://storyflow-auth.zjding.com
CRAFT_CLIENT_FEISHU_APP_ID=cli_aa9d901dfbb8dcd3
CRAFT_CLIENT_NEON_AUTH_BASE_URL=https://your-neon-auth.example.com/neondb/auth
CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN=users.craft.invalid
CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED=false
STORYFLOW_FEEDBACK_ENDPOINT=https://storyflow-feedback.zjding.com/api/feedback
CLOUDFLARE_ACCOUNT_ID=...
STORYFLOW_R2_PUBLIC_BASE_URL=https://story-storage.zjding.com
STORYFLOW_R2_LATEST_PREFIX=latest
STORYFLOW_R2_RELEASE_PREFIX=releases
STORYFLOW_PAGES_PROJECT_NAME=storyflow
```

GitHub repository secrets:

```dotenv
CSC_LINK=...
CSC_KEY_PASSWORD=...
APPLE_API_KEY_BASE64=...
APPLE_API_KEY_ID=...
APPLE_ID=...
APPLE_TEAM_ID=...
APPLE_APP_SPECIFIC_PASSWORD=...
STORYFLOW_R2_BUCKET=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_PAGES_API_TOKEN=...
STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET=...
STORYFLOW_GATEWAY_JWT_CURRENT_SECRET=...
STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET=...
```

`CRAFT_CLIENT_AUTH_BROKER_URL` is the canonical broker variable. The older
`CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL` remains a compatibility fallback in code,
but new configuration should not use it.

Broker, Neon Auth, and explicit Neon JWKS URLs must use HTTPS. Plain HTTP is
accepted only for loopback development; packaged-build validation rejects
loopback and insecure remote endpoints before release.

`CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED` controls whether the desktop exposes
registration. Authenticated Neon identities must have a verified email; no
Organization membership is required.

`STORYFLOW_FEEDBACK_ENDPOINT` is public client bootstrap configuration. Official
builds should point it at the first-party feedback Worker custom domain, not the
`workers.dev` deployment URL, because installed desktop clients must not depend
on Cloudflare's development hostname being reachable from the user's network.

Skill discovery, publication, and installation use the fixed first-party
Storyflow Skills Market origin. Desktop publication obtains a five-minute
`skills:publish` capability from the auth broker; the capability is never
persisted or exposed to renderer code.

## Auth Broker / Web UI Server

Server-only values stay on the broker or Web UI server. They must not be baked
into Electron.

```dotenv
CRAFT_WEBUI_FEISHU_APP_ID=cli_xxx
CRAFT_WEBUI_FEISHU_APP_SECRET=...
CRAFT_WEBUI_FEISHU_REDIRECT_URI=...
CRAFT_WEBUI_FEISHU_SCOPE=...
CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS=false
CRAFT_WEBUI_FEISHU_INTERNAL_TENANT_KEYS=
CRAFT_WEBUI_AUTH_DATABASE_URL=...
CRAFT_WEBUI_NEON_AUTH_BASE_URL=...
CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN=users.craft.invalid
CRAFT_WEBUI_NEON_AUTH_SIGN_UP_ENABLED=false
STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID=client-session-2026-07
STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET=...
STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_KEY_ID=
STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_SECRET=
STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID=model-access-2026-07
STORYFLOW_GATEWAY_JWT_CURRENT_SECRET=...
STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID=skills-market-2026-08
STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET=...
STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_KEY_ID=tool-access-2026-08
STORYFLOW_TOOL_GATEWAY_JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
```

The desktop app asks the broker for public Feishu config and sends OAuth codes
back to the broker. The Feishu app secret and user allow policy belong on the
broker side only. After verifying either Feishu or a Neon Organization identity, the broker
returns the identity session and model capability, then mints narrower
capabilities on demand:

- an `appSessionToken` bounded to 90 days from the original authentication,
  signed only with the client-session key, which may request rotated replacement
  tokens without extending that absolute lifetime;
- a 24-hour `modelAccessToken`, signed with the model-access key, which may
  call the model gateway but cannot mint another token.
- a five-minute Market publish token, requested only when the user publishes,
  signed with the Market key and scoped only to `skills:publish`.
- a 24-hour tool token, kept only in Electron memory, signed with the Tool
  Gateway key and scoped to the operation-specific `web:search` and
  `web:scrape` capabilities.

The broker requires a new login when the app session cannot cover another
12-hour operation plus clock skew, so a model capability can never outlive the
parent authentication.

The RPC/Web UI secret, client-session secret, model-access secret, Market
secret, and Tool Gateway secret must be independently generated and never share a
value. `STORYFLOW_CLIENT_SESSION_JWT_PREVIOUS_*` is used only while rotating
existing app sessions. Every runtime requires the explicit `CURRENT_*`
variables; retired unkeyed secret aliases are rejected.

`CRAFT_BUILTIN_LLM_API_KEY` is retired and no longer read. Managed model
credentials must come from the authenticated client session; do not place a
static gateway token in Electron defaults, build variables, or runtime env.

`CRAFT_WEBUI_NEON_AUTH_SIGN_UP_ENABLED` controls the standalone Web UI email
registration endpoint and sign-up tab. Email sign-in remains available when it
is `false`; sign-up requests return 403 before contacting Neon Auth. Neon Auth
must enable email/password sign-up and verification. Neon Organization owns
invitations and membership; the broker does not maintain a second admission
database.

## Model Gateway Worker

The model gateway is the only component that receives the NewAPI credential:

```dotenv
STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID=model-access-2026-07
STORYFLOW_GATEWAY_JWT_CURRENT_SECRET=...
STORYFLOW_GATEWAY_JWT_PREVIOUS_KEY_ID=
STORYFLOW_GATEWAY_JWT_PREVIOUS_SECRET=
NEWAPI_API_KEY=...
NEWAPI_UPSTREAM_BASE_URL=https://jzapi.duanju.com
```

The gateway `CURRENT_KEY_ID` and `CURRENT_SECRET` must match the broker's
model-access signing key; they must not match the broker's client-session key.
During rotation, the gateway accepts both current and previous keyed model
tokens. Tokens without `kid` are rejected.

`NEWAPI_API_KEY` and symmetric JWT secrets are Cloudflare
Worker secrets; key IDs and `NEWAPI_UPSTREAM_BASE_URL` are non-secret Worker
variables. None belong in Electron build environment variables. Capability
signing secrets used by the existing model and Market deployment are mirrored
in GitHub Actions only as Worker deployment inputs. Tool capability signing is
asymmetric, so its private key stays Cloudflare-only. `NEWAPI_API_KEY` remains Cloudflare-only.

## Tool Gateway Worker

The Tool Gateway is the only Storyflow component that receives provider tool
credentials. Its first operations are `POST /v1/search` (AnySearch) and
`POST /v1/scrape` (Firecrawl):

```dotenv
STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_KEY_ID=tool-access-2026-08
STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...
STORYFLOW_TOOL_GATEWAY_JWT_PREVIOUS_KEY_ID=
STORYFLOW_TOOL_GATEWAY_JWT_PREVIOUS_PUBLIC_KEY=
ANYSEARCH_API_KEY=...
ANYSEARCH_UPSTREAM_URL=https://api.anysearch.com/mcp
FIRECRAWL_API_KEY=...
FIRECRAWL_UPSTREAM_URL=https://api.firecrawl.dev/v2/scrape
```

The Tool Gateway verifies ES256 tokens with the public half of the Auth Broker
signing key. `ANYSEARCH_API_KEY`, `FIRECRAWL_API_KEY`, and the Auth Broker
private key are Cloudflare Worker Secrets only: do not copy them to GitHub,
Electron, Skills, MCP configuration, or CLI environment. The Worker applies
the native `SEARCH_RATE_LIMITER` and `SCRAPE_RATE_LIMITER` bindings per JWT
subject before consuming provider quota.

## Electron Runtime Internals

These variables are set by the Electron app for child processes and bundled
tools. They are plumbing, not user configuration:

```dotenv
CRAFT_IS_PACKAGED=1
CRAFT_RESOURCES_BASE=...
CRAFT_APP_ROOT=...
CRAFT_UV=...
CRAFT_BUN=...
CRAFT_SCRIPTS=...
CRAFT_COMMANDS_ENTRY=...
CRAFT_CLI_ENTRY=...
CRAFT_AGENT_VERSION=...
STORYFLOW_MODEL_ACCESS_BROKER_URL=http://127.0.0.1:...
STORYFLOW_MODEL_ACCESS_BROKER_TOKEN=process-random-capability
STORYFLOW_TOOL_BROKER_URL=http://127.0.0.1:...
STORYFLOW_TOOL_BROKER_TOKEN=process-random-capability
```

Do not put these in release vars or `.env` unless debugging a specific runtime
resolver path. The loopback broker values are generated per desktop process;
they contain no provider credential or cloud tool JWT.

## Installed-Client Recovery

If an installed desktop build has a bad broker URL, use the runtime override
file instead of rebuilding immediately:

```json
{ "authBrokerUrl": "https://storyflow-auth.zjding.com" }
```

Path by platform:

- macOS: `~/Library/Application Support/Storyflow/client-auth.json`
- Windows: `%APPDATA%/Storyflow/client-auth.json`
- Linux: `~/.config/Storyflow/client-auth.json`

The override wins over packaged defaults and is only intended as a recovery
channel.
