# Managed access: acceptance and cutover (#42)

Code and migrations implement current Account Access and revocable Identity Sessions. Checked-in Worker configs intentionally remain `legacy` until the coordinated release below; this mode does **not** revoke already-issued capabilities. This document is an operator runbook, not evidence of production deployment.

## Local acceptance (no paid provider requests)

From the repository root, with Bun and Node 22+ installed:

```sh
bun test apps/auth-broker-worker/src/managed-access.test.ts
bun run --cwd apps/auth-broker-worker typecheck
bun test apps/electron/src/main/__tests__/client-auth.test.ts apps/electron/src/main/__tests__/client-auth-broker.test.ts packages/server-core/src/sessions/managed-gateway-auth-error.test.ts
bun test scripts/build/managed-auth-deployment.test.ts scripts/build/verify-skills-market-auth.test.ts
```

The Worker acceptance bundles all three production entrypoints, starts Miniflare under Node, applies both real D1 migrations, and connects Gateways to `AccessAuthority` by native Service Bindings. Identity and provider responses are controlled at their outbound HTTP boundary. Bun remains the test entrypoint; Bun 1.4's repeated Miniflare fetch connection reset was reproduced independently and the identical scenario passed under Node.

Assertions cover separate logins, policy reduction and grant, old-token scope ceilings, catalog filtering, idempotent logout, revoke-all, disabled-account login races, re-enable without session resurrection, late renewal after revoke, persisted state across Worker restart and key rotation, signature/key/expiry/session errors, and a real missing-state-table outage with no upstream calls. Market issuance is denied after disable; a previously issued token remains independently verifiable for its 300-second limit. Existing handler tests cover login admission, protocols, absolute lifetimes and rate limits.

State reads emit `managed_access_state_read` with duration, query count and D1 rows read. Each model/tool authorization performs one primary SELECT (no allow cache). The local suite prints p50/p95 and aggregate rows; these are local state-read timings, not production network latency. A local run on 2026-09-16 observed 33 reads, 63 rows, p50 0 ms and p95 1 ms. Use Worker observability to record production RPC latency and D1 read volume before/after cutover; outages must never be mitigated by bypassing authorization.

## Operator changes

Use a Cloudflare **user API token** with D1 edit permission and account visibility. Export `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` through the existing secret environment. The script verifies the active token identity and records its ID as the actor; credentials are never CLI arguments or output. It does not accept account-owned tokens as user identities.

```sh
# Obtain the existing database UUID using the normal Cloudflare operator identity.
bunx wrangler@4.114.0 d1 info storyflow-access --config apps/auth-broker-worker/wrangler.toml
# Preview first; --apply executes one parameterized SQL statement.
bun scripts/access-admin.ts --database "$ACCESS_DATABASE_ID" --operation disable --target 'neon:USER_ID'
bun scripts/access-admin.ts --database "$ACCESS_DATABASE_ID" --operation disable --target 'neon:USER_ID' --apply
bun scripts/access-admin.ts --database "$ACCESS_DATABASE_ID" --operation enable --target 'neon:USER_ID' --apply
bun scripts/access-admin.ts --database "$ACCESS_DATABASE_ID" --operation revoke-all --target 'neon:USER_ID' --apply
bun scripts/access-admin.ts --database "$ACCESS_DATABASE_ID" --operation revoke-session --target "$SESSION_ID" --apply
bun scripts/access-admin.ts --database "$ACCESS_DATABASE_ID" --operation scopes --target 'neon:USER_ID' --value 'model:chat,catalog:read,web:search' --apply
bun scripts/access-admin.ts --database "$ACCESS_DATABASE_ID" --operation models --target 'neon:USER_ID' --value 'gpt-5.5,deepseek-v4-flash' --apply
```

`models --value all` allows all globally approved models; `--value ''` denies all models/scopes. Unknown capabilities are rejected. Use provider-qualified subjects, never an email merge. `affected: 0` means no target was changed; do not report it as a successful revocation of a live session. Database triggers atomically record successful account changes and each actual session revocation in `access_audit`, with actor, target, operation, time, result and policy details. Failed/unknown remote requests report an error without claiming a change.

## Provision and release

1. Deploy the Broker in `legacy` mode. Wrangler 4.114 auto-provisions/binds the named `storyflow-access` D1 database when no ID is supplied. Apply `bunx wrangler@4.114.0 d1 migrations apply storyflow-access --remote --config apps/auth-broker-worker/wrangler.toml`; verify both migrations. Existing databases can be pinned by their real `database_id`; never invent a resource ID. Deploy both gateways with `ACCESS_AUTHORITY` bound to `storyflow-auth-broker`, entrypoint `AccessAuthority`, in the same Cloudflare account. The managed-auth workflow follows this dependency order.
2. Release the desktop that understands structured failures and remote logout. In the migration window a no-sid logout cannot confirm remote revocation; the local-logout warning is intentional. Preserve conversations, files and custom Provider credentials.
3. During a maintenance window, pause managed traffic and switch the Broker to `required` using a deployment override. Perform one genuine login using an isolated release identity, then store its resulting `appSessionToken` as the protected GitHub secret `STORYFLOW_ACCESS_CANARY_SESSION` (do not paste it into a ticket or terminal log). Its sid must exist in D1 and have the canary's model, catalog, tool and Market permissions. Rotate this secret after expiry, logout or operator revoke; renewal cannot extend the original 90-day bound.
4. Change all three checked-in `STORYFLOW_ACCESS_ENFORCEMENT` values to `required`, regenerate Worker types, and run the managed-auth deployment workflow with the persisted canary secret. `/ready` must pass for Broker and Gateways; required mode without D1/schema/RPC fails readiness. The release canary uses the persisted session instead of an untracked hand-signed JWT. Its existing live model/search calls may incur provider usage; local acceptance above does not.
5. Before restoring traffic, verify old no-sid identity/model/tool tokens all return 401 with the legacy reason, revoked credentials remain rejected, and a fresh login can use its granted capabilities. Re-enabling an account must require fresh login. Announce that existing installations must sign in once. No old token may enroll itself into D1. Only after this gate is the revocation guarantee active.

Mixed modes are a maintenance transition, never an accepted steady state. Do not deploy a gateway to a different account and expose an HTTP authorization endpoint as a workaround. Subsequent releases must retain `required`; remove the migration escape hatch once all managed deployments have completed their cutover and the old-client recovery window has closed.

## Electron QA (isolated profiles and controlled upstream)

Use a dedicated staging Broker/Gateway pointing at an observable fixture provider, and two separate OS/test profiles. Build the desktop with `CRAFT_CLIENT_AUTH_BROKER_URL` pointing at that Broker. Do not alter a user's active profile or print tokens. The normal automated contract suite does not claim this GUI run was performed.

1. Sign in with Feishu and a verified Neon identity. Call a permitted model/tool, restart the app, and call again. Existing messages/files survive. A custom Provider connection still works independently of Storyflow login.
2. With two profiles logged into the same account, sign out in the first. It immediately shows signed out; its saved test credentials fail on the next model/tool request, while the second profile still works. A refresh already in flight cannot restore the first profile. Cancelled operations remain cancelled; no user turn is replayed.
3. Disconnect the network and sign out. Verify the app clears local identity and shows “Signed out locally; remote session revocation could not be confirmed.” Reconnect: the app stays signed out. Use the operator revoke command for uncertain remote sessions; the client must not retain credentials for a background retry queue.
4. Reduce model/scopes with the operator command. The next catalog/call reflects the restriction; the UI shows access denied with a diagnostic reference and no retry/fallback. Disable then enable: old sessions remain invalid, fresh login succeeds. Break the staging authorization dependency: the UI shows temporary unavailability, preserves login and sends no provider request.
5. Match the UI reference to `managed_access_denied` logs. Model logs also carry validated existing Model Call/Transport Attempt context. Invalid client headers must not become trusted identity; token, prompt and provider key must be absent. Upstream failures continue to use #41's separate error/fallback contract.

## Boundaries and rollback

Revocation applies to requests whose current-state authorization begins after revocation commits; an already-authorized stream may finish. Each later Agent-loop model request rechecks. External Neon/Feishu administrative changes are not automatically synchronized to Storyflow; use the Storyflow operator command to disable access. Registry's already-issued Market tokens retain at most 300 seconds; organization and package ownership rules remain in that resource boundary.

After cutover, roll back only to a version that still performs current-state authorization against the same persisted records. Never reset D1, remove revocations, restore an old allowing snapshot, or change the mode to `legacy`. If no safe rollback exists, keep managed entrypoints unavailable and fix forward. Custom Provider credentials and user content remain independent.
