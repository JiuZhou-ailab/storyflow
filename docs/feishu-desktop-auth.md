# Desktop Auth and Model Access

Storyflow keeps identity login, product sessions, and upstream model credentials
as separate trust boundaries:

```text
desktop login
  -> auth broker verifies Feishu or Neon identity
  -> auth broker returns an appSessionToken (absolute 30 days from login)
     plus a short-lived modelAccessToken (15 minutes)
  -> desktop keeps the login session and projects modelAccessToken
     into the hidden managed connection
  -> desktop refreshes both tokens before model access expires
  -> model gateway validates modelAccessToken
  -> model gateway injects the server-only NewAPI key
  -> NewAPI
```

Feishu users receive `model_tier=pro`. Neon email users receive
`model_tier=standard`. Both tiers currently have the same model access; the
claim is already separate so future policy changes stay inside the model
gateway.

Every successful refresh may rotate `appSessionToken` and its signing key, but
preserves the original `auth_time` and absolute 30-day expiry.
During the final 15 minutes the broker requires a new login instead of issuing
a model token that would outlive its parent session.
`appSessionToken` has only `model:issue` scope and is accepted only by the auth
broker; `modelAccessToken` has only `model:chat` scope and is accepted only by
the model gateway. Both use `iss=storyflow-auth-broker`; their audiences are
`storyflow-client-auth` and `storyflow-model-gateway`, respectively.

The desktop app must never contain the Feishu app secret, either JWT signing
secret, or the NewAPI key. The client-session and model-access secrets are
separate trust boundaries and must be generated independently.

## Feishu OAuth

The desktop Feishu flow is:

1. The desktop asks `CRAFT_CLIENT_AUTH_BROKER_URL` for public Feishu OAuth config.
2. It opens Feishu authorization with PKCE.
3. Feishu redirects to the loopback callback.
4. The desktop sends the code and verifier to the broker.
5. The broker exchanges the code with its server-only Feishu secret.
6. The broker checks the company tenant allowlist and returns the user, a
   renewable app session, and a short-lived `pro` model access token.

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
and returns a renewable app session plus a short-lived `standard` model access
token.

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
GET  /ready
POST /v1/responses
POST /v1/chat/completions  # legacy desktop compatibility
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

The first means the renewable login session is missing, expired, or invalid and
requires login. The second means the desktop should refresh once through the
broker; it is not evidence that the selected model name is invalid.

The MVP deliberately uses one NewAPI key and one upstream for both roles. Add
per-tier model allowlists only when Standard and Pro actually diverge; add
per-user NewAPI keys only when upstream accounting or revocation requires them.

The active managed endpoint uses the OpenAI Responses API
(`customEndpoint.api=openai-responses`). The gateway still accepts legacy Chat
Completions requests from older desktop releases during migration.

## Local Development

The built-in local broker requires three independent trust boundaries:

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
renewable desktop sessions, and `STORYFLOW_GATEWAY_JWT_CURRENT_SECRET` signs
short-lived model access. All three values must differ. The legacy
unkeyed secret names are rejected.

## Production Deployment

Packaged Electron builds contain public bootstrap values only:

```dotenv
CRAFT_CLIENT_AUTH_REQUIRED=true
CRAFT_CLIENT_AUTH_BROKER_URL=https://storyflow-auth.zjding.com
CRAFT_CLIENT_FEISHU_APP_ID=cli_xxx
CRAFT_CLIENT_NEON_AUTH_BASE_URL=https://your-neon-auth.example.com/neondb/auth
```

Configure two independent keys:

| Key | Auth broker | Model gateway |
| --- | --- | --- |
| Client session | `STORYFLOW_CLIENT_SESSION_JWT_CURRENT_KEY_ID`, `STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET` | never present |
| Model access | `STORYFLOW_GATEWAY_JWT_CURRENT_KEY_ID`, `STORYFLOW_GATEWAY_JWT_CURRENT_SECRET` | same key ID and secret |

Key IDs are non-secret Worker variables. Put only the secret values in
Cloudflare secrets:

```bash
cd apps/auth-broker-worker
bunx wrangler secret put STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET
bunx wrangler secret put STORYFLOW_GATEWAY_JWT_CURRENT_SECRET
bunx wrangler deploy

cd ../model-gateway-worker
bunx wrangler secret put STORYFLOW_GATEWAY_JWT_CURRENT_SECRET
bunx wrangler secret put NEWAPI_API_KEY
bunx wrangler deploy
```

The model gateway upstream URL is a non-secret Worker variable in
`apps/model-gateway-worker/wrangler.toml`. Rotate any upstream key that has ever
been pasted into chat, logs, or source before deployment.

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
the new current key. Remove the gateway previous key after 15 minutes plus
clock skew.

For client-session rotation, deploy the broker with the new key as `CURRENT_*`
and the old value as `PREVIOUS_*`. Successful refreshes roll sessions to the
new key without extending their original expiry. Keep the previous key for at
most 30 days unless forcing inactive clients to sign in again is acceptable.

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
