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
process bundle. Only public client bootstrap values belong here, except for the
managed model gateway token, which must come from GitHub Actions secrets.

GitHub repository vars:

```dotenv
CRAFT_CLIENT_AUTH_BROKER_URL=https://storyflow-auth.zjding.com
CRAFT_CLIENT_FEISHU_APP_ID=cli_aa9d901dfbb8dcd3
CRAFT_CLIENT_NEON_AUTH_BASE_URL=https://your-neon-auth.example.com/neondb/auth
CRAFT_CLIENT_NEON_AUTH_USERNAME_EMAIL_DOMAIN=users.craft.invalid
CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED=false
CLOUDFLARE_ACCOUNT_ID=...
STORYFLOW_R2_PUBLIC_BASE_URL=https://story-storage.zjding.com
STORYFLOW_R2_LATEST_PREFIX=latest
STORYFLOW_R2_RELEASE_PREFIX=releases
STORYFLOW_PAGES_PROJECT_NAME=storyflow
```

GitHub repository secrets:

```dotenv
CRAFT_CLIENT_GATEWAY_TOKEN=cfut_...
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
```

`CRAFT_CLIENT_AUTH_BROKER_URL` is the canonical broker variable. The older
`CRAFT_CLIENT_FEISHU_AUTH_BROKER_URL` remains a compatibility fallback in code,
but new configuration should not use it.

`CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED` only controls whether the packaged
desktop UI exposes email registration and allows the local sign-up IPC path.
Keep it `false` for invite-only or Feishu-only distribution. Set it to `true`
only after the matching Neon Auth branch allows email sign-up and has a working
email provider / verification policy.

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
```

The desktop app asks the broker for public Feishu config and sends OAuth codes
back to the broker. The Feishu app secret and user allow policy belong on the
broker side only.

`CRAFT_WEBUI_NEON_AUTH_SIGN_UP_ENABLED` controls the standalone Web UI email
registration endpoint and sign-up tab. Email sign-in remains available when it
is `false`; sign-up requests return 403 before contacting Neon Auth. Neon Auth
itself must still be configured in the Neon Console or API: enable email/password
sign-up, pick the verification policy, and configure email delivery. Neon shared
email supports verification codes; verification links require a custom provider.

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
```

Do not put these in release vars or `.env` unless debugging a specific runtime
resolver path.

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
