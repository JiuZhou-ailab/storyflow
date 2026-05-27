# Neon Auth WebUI Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal Neon Auth email identity bridge for Web UI sessions while keeping all model access behind the existing Craft model gateway.

**Architecture:** Neon Auth owns email/password sign-up and sign-in. The Web UI posts email or username credentials to the local server, the server forwards them to Neon Auth, exchanges the returned Better Auth session cookie for a JWT when needed, verifies the JWT with JWKS, and then issues the existing `craft_session` cookie. Billing, quotas, and token grants are intentionally out of scope for this pass.

**Tech Stack:** Bun, TypeScript, Vite Web UI, `jose`, Neon Auth REST endpoints.

---

### Task 1: Server-Side Neon JWT Verification

**Files:**
- Create: `packages/server-core/src/webui/neon-auth.ts`
- Test: `packages/server-core/src/webui/neon-auth.test.ts`

**Step 1: Write the failing test**

Add tests for:
- disabled config when no base URL is provided
- client config only exposes `enabled` and `baseUrl`
- a valid injected verifier returns a normalized user identity
- invalid verifier output is rejected

**Step 2: Run test to verify it fails**

Run: `bun test packages/server-core/src/webui/neon-auth.test.ts`

Expected: fail because `neon-auth.ts` does not exist.

**Step 3: Write minimal implementation**

Implement a small `NeonAuthService` that:
- normalizes `baseUrl`
- derives `jwksUrl`, `issuer`, and `audience`
- verifies JWTs through `jose.createRemoteJWKSet` by default
- supports an injected verifier for tests
- returns `{ userId, email, emailVerified, name }`

**Step 4: Run test to verify it passes**

Run: `bun test packages/server-core/src/webui/neon-auth.test.ts`

Expected: pass.

### Task 2: WebUI Auth Exchange Endpoint

**Files:**
- Modify: `packages/server-core/src/webui/http-server.ts`
- Modify: `packages/server-core/src/webui/index.ts`
- Test: `packages/server-core/src/webui/__tests__/http-server.test.ts`

**Step 1: Write the failing test**

Add HTTP tests for:
- `/api/auth/neon/config` returns disabled by default
- configured Neon Auth exposes only the public base URL
- `/api/auth/neon/exchange` rejects missing or invalid tokens
- `/api/auth/neon/exchange` sets `craft_session` for a valid Neon JWT
- `/api/auth/neon/email` signs in through Neon Auth and sets `craft_session`
- `/api/auth/neon/email` reports sign-up verification without setting a local session

**Step 2: Run test to verify it fails**

Run: `bun test packages/server-core/src/webui/__tests__/http-server.test.ts`

Expected: fail because the Neon Auth routes do not exist.

**Step 3: Write minimal implementation**

Wire `NeonAuthConfig` into `WebuiHandlerOptions`, create `NeonAuthService`, and add unauthenticated config, exchange, and email/password routes before the normal session gate.

**Step 4: Run test to verify it passes**

Run: `bun test packages/server-core/src/webui/__tests__/http-server.test.ts`

Expected: pass.

### Task 3: Server Env Wiring

**Files:**
- Modify: `packages/server/src/index.ts`

**Step 1: Add config parsing**

Read:
- `CRAFT_WEBUI_NEON_AUTH_BASE_URL`
- `CRAFT_WEBUI_NEON_AUTH_JWKS_URL`
- `CRAFT_WEBUI_NEON_AUTH_ISSUER`
- `CRAFT_WEBUI_NEON_AUTH_AUDIENCE`
- `CRAFT_WEBUI_NEON_AUTH_USERNAME_EMAIL_DOMAIN`
- `CRAFT_WEBUI_PASSWORD_AUTH_ENABLED`

**Step 2: Pass config to WebUI handler**

Only enable Neon Auth when `CRAFT_WEBUI_NEON_AUTH_BASE_URL` is non-empty.

**Step 3: Verify typecheck**

Run: `bun run --filter @craft-agent/server typecheck`

Expected: pass.

### Task 4: Login Page Email UI

**Files:**
- Modify: `apps/webui/src/login.html`

**Step 1: Add minimal email form**

When `/api/auth/neon/config` is enabled:
- support sign-in and sign-up modes
- post email or username credentials to `/api/auth/neon/email`
- redirect to `/` after `craft_session` is set
- show a verification-required message when Neon Auth requires email verification

**Step 2: Preserve fallback paths**

Keep server-token login available by default, but hide and reject it when `CRAFT_WEBUI_PASSWORD_AUTH_ENABLED=false`. Keep Feishu login available when configured.

**Step 3: Verify Web UI build**

Run: `bun run --filter @craft-agent/webui build`

Expected: pass.

### Task 5: Documentation and Verification

**Files:**
- Modify: `implementation-notes.md`
- Modify: `docs/plans/README.md`

**Step 1: Record decisions**

Document that token grant/accounting is intentionally deferred and all model access still goes through the existing gateway session.

**Step 2: Run focused verification**

Run:
- `bun test packages/server-core/src/webui/neon-auth.test.ts packages/server-core/src/webui/__tests__/http-server.test.ts`
- `bun run --filter @craft-agent/server-core typecheck`
- `bun run --filter @craft-agent/server typecheck`
- `bun run --filter @craft-agent/webui build`
- `git diff --check`

Expected: all pass.
