# Desktop Auth, Model Access, and Managed Tools

Storyflow keeps identity login, product sessions, and upstream model credentials
as separate trust boundaries:

```text
desktop login
  -> auth broker verifies Feishu or Neon identity
  -> auth broker returns an appSessionToken (absolute 90 days from login)
     plus a modelAccessToken (24 hours)
  -> before each Agent operation, desktop accepts a capability with at least
     just over 12 hours remaining or refreshes it once through the auth broker
  -> desktop injects the accepted capability before the Pi runtime lease starts
  -> model gateway validates modelAccessToken
  -> model gateway injects the server-only NewAPI key
  -> NewAPI

web_search / web_scrape installed tool methods
  -> random loopback capability reaches the Electron broker
  -> Electron obtains and caches operation-specific 24-hour capabilities in memory
  -> tool gateway validates web:search or web:scrape and injects the matching provider key
  -> AnySearch or Firecrawl
```

Feishu's tenant allowlist and Neon's native Organization membership are the two
admission boundaries. Feishu users receive `pro`; admitted Neon email users
receive `standard`.

Every successful refresh may rotate `appSessionToken` and its signing key, but
preserves the original `auth_time` and absolute 90-day expiry.
During the final 12 hours plus clock-skew margin the broker requires a new login instead of issuing
a model capability that cannot cover one operation safely.
`appSessionToken` has only `capability:issue` scope and is accepted only by the auth
broker; `modelAccessToken` has only `model:chat` scope and is accepted only by
the model gateway. Tool access uses a separately signed token with
operation-specific `web:search` and `web:scrape` scopes and the
`storyflow-tool-gateway` audience. All use
`iss=storyflow-auth-broker`.

There is no background refresh timer. Sleep, wake, and long idle periods are
handled by the next operation preflight. A running operation keeps its accepted
credential snapshot and is never interrupted by credential rotation.

The desktop app must never contain the Feishu app secret, any JWT signing
secret, the NewAPI key, or the AnySearch key. Every signing key is a separate
trust boundary and must be generated independently.

## Feishu OAuth

The desktop Feishu flow is:

1. The desktop asks `CRAFT_CLIENT_AUTH_BROKER_URL` for public Feishu OAuth config.
2. It opens Feishu authorization with PKCE.
3. Feishu redirects to the loopback callback.
4. The desktop sends the code and verifier to the broker.
5. The broker exchanges the code with its server-only Feishu secret.
6. The broker checks the company tenant allowlist and returns the user plus
   a bounded Storyflow identity session and model capability.

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

The desktop verifies email/password with Neon Auth and sends its signed JWT to
the same auth broker. The broker verifies Neon JWKS and the verified-email
identity before issuing standard Storyflow capabilities. Organization membership
is optional metadata rather than a prerequisite for email login.

When email registration is enabled, any address accepted by Neon Auth can sign
up and use the email OTP to prove ownership. Electron uses the Better Auth
session only to establish the bounded Storyflow Identity Session; it does not
persist or consult the provider session during routine model access.

Email sign-in and registration are independent switches:

```dotenv
CRAFT_CLIENT_NEON_AUTH_SIGN_UP_ENABLED=false
CRAFT_WEBUI_NEON_AUTH_SIGN_UP_ENABLED=false
```

Enable registration only after OTP verification, restart recovery, and rejection
of unverified or banned identities have been exercised in the target environment.

## Model Gateway

The bundled managed connections point to:

```text
https://storyflow-model.zjding.com/v1
```

Only these public routes exist:

```text
GET  /health
GET  /ready
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
POST /v1/messages
POST /v1beta/models/:model:generateContent
POST /v1beta/models/:model:streamGenerateContent
```

For model calls, the Worker validates the HS256 token signature, issuer,
audience, expiry, subject, `model:chat` scope, and `model_tier`. It then replaces
the client authorization header with its server-only `NEWAPI_API_KEY` and
forwards the request to `NEWAPI_UPSTREAM_BASE_URL`.

Stable authentication failures are machine-readable:

- broker `POST /api/client-auth/token`: `401` with
  `code=client_session_token_invalid`;
- gateway `POST /v1/responses`: `401` with
  `code=model_access_token_invalid`.
- gateway upstream service authentication: `502` with
  `code=upstream_auth_failed`.

The first means the bounded login session is missing, expired, or invalid and
requires login. The second means the desktop should renew once through the
broker for the next explicit operation; it is not evidence that the selected
model name is invalid.

The MVP deliberately uses one NewAPI key and one upstream for both roles. Add
per-tier model allowlists only when Standard and Pro actually diverge; add
per-user NewAPI keys only when upstream accounting or revocation requires them.

Managed models are split by native protocol instead of sharing one converted
connection:

- GPT uses OpenAI Responses (`/v1/responses`);
- DeepSeek uses OpenAI Chat Completions (`/v1/chat/completions`);
- Gemini uses Google GenAI (`/v1beta/models/:model:streamGenerateContent`);
- Claude Sonnet 5 and Opus 5 use Anthropic Messages (`/v1/messages`).

The static catalog is the offline capability fallback. The authenticated
gateway intersects explicitly approved dynamic families such as
`gemini-3.6-*` with the live NewAPI inventory, so unavailable or invented model
IDs never appear in the desktop picker.

All connections reuse the same bounded model capability, while the gateway
replaces its protocol-native auth header with the server-only `NEWAPI_API_KEY`.

## Managed Tool Gateway

The bundled `web_search` and `web_scrape` tools call the Electron-owned
loopback broker. Child processes receive only a process-random local
capability; the broker obtains the cloud tool token, refreshes once after a
gateway `401`/`403`, and proxies the fixed `POST /v1/search` or
`POST /v1/scrape` operation. The Tool Gateway validates the matching
operation-specific capability, bounds the request and response, and injects
its Cloudflare-only AnySearch or Firecrawl key.

Provider APIs are adapters behind product operations, not a generic HTTP/MCP
proxy. Tool Method Packages wired to these operations therefore carry no
provider key and remain unchanged if the upstream provider changes. Managed
search falls back to the credential-free DuckDuckGo provider when this path is
unavailable. The existing AnySearch CLI's vertical, batch, and extract methods
remain outside this first managed operation.

## Local Development

The built-in local auth broker covers the existing client-session and model
flow:

```dotenv
CRAFT_CLIENT_AUTH_REQUIRED=true
CRAFT_CLIENT_AUTH_BROKER_URL=http://localhost:9100
CRAFT_CLIENT_FEISHU_APP_ID=cli_xxx
CRAFT_WEBUI_FEISHU_APP_ID=cli_xxx
CRAFT_WEBUI_FEISHU_APP_SECRET=server-only-secret
CRAFT_WEBUI_FEISHU_ALLOW_ALL_USERS=true
CRAFT_SERVER_TOKEN=replace-with-an-rpc-and-webui-secret
STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID=client-session-local
STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET=replace-with-a-client-session-secret
STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID=model-access-local
STORYFLOW_GATEWAY_JWT_CURRENT_SECRET=replace-with-a-separate-model-secret
```

`bun run electron:dev` starts the local broker automatically when the broker URL
is localhost and no broker is healthy. `CRAFT_SERVER_TOKEN` authenticates RPC
and Web UI sessions only. `STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET` signs
bounded desktop sessions, and `STORYFLOW_GATEWAY_JWT_CURRENT_SECRET` signs
model capabilities. All three values must differ. The legacy
unkeyed secret names are rejected.

The local embedded broker does not emulate the managed Tool Gateway. Local
development therefore uses the existing DuckDuckGo fallback unless it targets
the deployed Auth Broker and Tool Gateway.

## Production Deployment

Packaged Electron builds contain public bootstrap values only:

```dotenv
CRAFT_CLIENT_AUTH_REQUIRED=true
CRAFT_CLIENT_AUTH_BROKER_URL=https://storyflow-auth.zjding.com
CRAFT_CLIENT_FEISHU_APP_ID=cli_xxx
CRAFT_CLIENT_NEON_AUTH_BASE_URL=https://your-neon-auth.example.com/neondb/auth
```

The desktop shell requires a signed-in Feishu or verified-email identity.

Configure four independent signing keys:

| Key | Auth broker | Resource server |
| --- | --- | --- |
| Client session | `STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID`, `STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET` | never present |
| Model access | `STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID`, `STORYFLOW_GATEWAY_JWT_CURRENT_SECRET` | same values on Model Gateway |
| Skills Market | `STORYFLOW_SKILLS_MARKET_JWT_CURRENT_KEY_ID`, `STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET` | same values on Skills Market |
| Tool access | `STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_KEY_ID`, `STORYFLOW_TOOL_GATEWAY_JWT_PRIVATE_KEY` | matching key ID and `STORYFLOW_TOOL_GATEWAY_JWT_CURRENT_PUBLIC_KEY` |

Key IDs are non-secret Worker variables. Put only the secret values in
Cloudflare secrets:

```bash
cd apps/auth-broker-worker
bunx wrangler secret put STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET
bunx wrangler secret put STORYFLOW_GATEWAY_JWT_CURRENT_SECRET
bunx wrangler secret put STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET
bunx wrangler secret put STORYFLOW_TOOL_GATEWAY_JWT_PRIVATE_KEY
bunx wrangler deploy

cd ../model-gateway-worker
bunx wrangler secret put STORYFLOW_GATEWAY_JWT_CURRENT_SECRET
bunx wrangler secret put NEWAPI_API_KEY
bunx wrangler deploy

cd ../tool-gateway-worker
bunx wrangler secret put ANYSEARCH_API_KEY
bunx wrangler secret put FIRECRAWL_API_KEY
bunx wrangler deploy
```

The model gateway upstream URL is a non-secret Worker variable in
`apps/model-gateway-worker/wrangler.toml`. Rotate any upstream key that has ever
been pasted into chat, logs, or source before deployment.

`ANYSEARCH_API_KEY` and `FIRECRAWL_API_KEY` are maintained only as Tool Gateway
Worker Secrets. Tool capabilities use ES256: the private key exists only on the
Auth Broker and the matching public key is a non-secret Tool Gateway variable.
Neither private nor provider key is mirrored into GitHub Actions.

### Migration and rotation

For the cutover from the retired single model token:

1. Generate independent client-session and model-access secrets.
2. Configure the model-access current key on the gateway and broker, then
   deploy the gateway first.
3. Configure the client-session current key and deploy the broker.
4. Deploy the dual-token desktop. Sessions created by the retired
   `wangsu-default` login path have no `appSessionToken` and migrate to
   `storyflow-managed` after the user signs in once;
   there is no safe refresh credential to migrate. Remove
   `CRAFT_BUILTIN_LLM_API_KEY` from build/runtime configuration; current clients
   ignore it and bundled defaults no longer carry or seed model credentials.
5. Delete the retired Worker and unkeyed secret bindings after the live
   refresh-to-chat canary passes.

For later model-key rotation, deploy the gateway first with the new key as
`CURRENT_*` and the old keyed value as `PREVIOUS_*`, then switch the broker to
the new current key. Remove the gateway previous key after 24 hours plus
clock skew.

For client-session rotation, deploy the broker with the new key as `CURRENT_*`
and the old value as `PREVIOUS_*`. Successful refreshes roll sessions to the
new key without extending their original expiry. Keep the previous key for at
most 90 days unless forcing inactive clients to sign in again is acceptable.

For tool-capability rotation, deploy the Tool Gateway first with the new public
key as `CURRENT_*` and the old public key as `PREVIOUS_*`, then replace the Auth
Broker private key. Remove the previous public key after 24 hours plus clock
skew.

Managed default access is intentionally unavailable in standalone, thin-client,
and shared-server modes. Those runtimes do not have a per-client credential
context; writing one desktop user's model token into the server-wide credential
store would cross account boundaries. Use a user-configured provider there
until RPC authentication carries a per-session model capability.

### Canary

Health and unauthenticated checks:

```bash
curl -i https://storyflow-auth.zjding.com/health
curl -i https://storyflow-model.zjding.com/health
curl -i -X POST https://storyflow-model.zjding.com/v1/responses
```

The final request must return `401` with
`code=model_access_token_invalid`. To verify refresh and gateway access with a
test account without placing either token in shell history, command arguments,
or output, run:

```bash
set +x
AUTH_BROKER_URL=https://storyflow-auth.zjding.com
MODEL_GATEWAY_URL=https://storyflow-model.zjding.com
read -rsp 'appSessionToken: ' APP_SESSION_TOKEN
printf '\n'
trap 'unset APP_SESSION_TOKEN REFRESH_JSON MODEL_ACCESS_TOKEN' EXIT INT TERM

REFRESH_JSON="$(
  printf 'header = "Authorization: Bearer %s"\n' "$APP_SESSION_TOKEN" |
    curl --silent --show-error --fail-with-body --config - \
      --request POST "$AUTH_BROKER_URL/api/client-auth/token"
)"
jq -e '
  .ok == true
  and (.appSessionToken | type == "string")
  and (.modelAccessToken | type == "string")
' >/dev/null <<<"$REFRESH_JSON"
MODEL_ACCESS_TOKEN="$(jq -er '.modelAccessToken' <<<"$REFRESH_JSON")"
printf 'refresh: ok\n'

printf 'header = "Authorization: Bearer %s"\n' "$MODEL_ACCESS_TOKEN" |
  curl --silent --show-error --fail-with-body --config - \
    --header 'Content-Type: application/json' \
    --data '{"model":"gpt-5.5","input":"Reply exactly: OK","max_output_tokens":16,"stream":false}' \
    "$MODEL_GATEWAY_URL/v1/responses"
```

Do not enable shell tracing or paste a token directly into a command. The
refresh response remains captured in memory and is not printed; the gateway
response is the only response written to stdout.

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
