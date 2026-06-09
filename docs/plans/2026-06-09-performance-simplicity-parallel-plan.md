# Performance And Simplicity Parallel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Improve user-visible performance and project simplicity without collapsing independent concerns into one large refactor.

**Architecture:** Keep the current observability baseline as the shared starting point, then dispatch agents by ownership domain. Session persistence, browser resource policy, chat turn rendering, AppShell novel workflow, and product-surface simplification must stay orthogonal; only the coordinator integrates results.

**Tech Stack:** Bun, TypeScript, Electron main/renderer, React, Jotai, `@craft-agent/server-core`, `@craft-agent/shared`, `@craft-agent/ui`.

---

## Current Baseline

The current worktree already contains a small observability slice:

- `packages/server-core/src/sessions/SessionManager.ts`
  - Adds `session.sendMessage.accept` perf span around pending-plan cleanup, lazy message load, synchronous flush, and ack.
- `apps/electron/src/main/browser-pane-manager.ts`
  - Adds soft browser instance budget logging with `CRAFT_BROWSER_INSTANCE_SOFT_LIMIT`.
- `apps/electron/src/main/__tests__/browser-pane-manager.test.ts`
  - Covers the soft-budget warning.

Before parallel work starts, the coordinator should commit this baseline or ensure every agent starts from the same uncommitted patch. Parallel agents must not independently recreate or revert this slice.

Baseline verification already run:

```bash
bun test apps/electron/src/main/__tests__/browser-pane-manager.test.ts
bun x tsc --noEmit --pretty false --project packages/server-core/tsconfig.json
bun x tsc --noEmit --pretty false --project apps/electron/tsconfig.json
git diff --check
```

## Parallelization Rules

1. Start all agents from the same baseline commit.
2. One write owner per file domain.
3. Only Agent D may edit `apps/electron/src/renderer/components/app-shell/AppShell.tsx`.
4. No agent may change provider routing, managed/custom provider behavior, or formal-novel method-pack semantics unless explicitly assigned.
5. Prefer tests and measurements before behavior changes.
6. Do not introduce hard resource caps without a product decision; soft logging and safe cleanup are allowed.
7. Each agent returns: changed files, root finding, verification commands, residual risk.

## Wave 0: Coordinator Baseline

**Files:**
- Stage only:
  - `packages/server-core/src/sessions/SessionManager.ts`
  - `apps/electron/src/main/browser-pane-manager.ts`
  - `apps/electron/src/main/__tests__/browser-pane-manager.test.ts`

**Steps:**

1. Confirm no unrelated staged files:

```bash
git status --short
git diff --stat
```

2. Re-run the baseline targeted checks:

```bash
bun test apps/electron/src/main/__tests__/browser-pane-manager.test.ts
bun x tsc --noEmit --pretty false --project packages/server-core/tsconfig.json
bun x tsc --noEmit --pretty false --project apps/electron/tsconfig.json
git diff --check
```

3. Commit the baseline:

```bash
git add \
  packages/server-core/src/sessions/SessionManager.ts \
  apps/electron/src/main/browser-pane-manager.ts \
  apps/electron/src/main/__tests__/browser-pane-manager.test.ts
git commit -m "perf: add session accept and browser budget telemetry"
```

4. Create one branch/worktree per agent from this commit.

## Wave 1: Parallel Agents

### Agent A: Session Accept Latency Evidence

**Scope:** Server-core session send/ack path only.

**Files:**
- Modify: `packages/server-core/src/sessions/sendmessage-durability.test.ts`
- Modify only if required: `packages/server-core/src/sessions/SessionManager.ts`
- Avoid: `apps/electron/**`, `packages/shared/src/sessions/persistence-queue.ts` unless a failing test proves the need.

**Goal:** Prove `session.sendMessage.accept` captures the ack-before-agent-init path and keeps the durability contract intact.

**Required steps:**

1. Add a regression test that enables perf collection with `configurePerfTracking({ enabled: true, onMetric })`.
2. In the normal `sendMessage` branch, assert that a metric named `session.sendMessage.accept` is emitted before post-ack agent init failure is caught.
3. Assert metric metadata includes `status: "accepted"` and a `messageCount` greater than zero.
4. Assert marks include at least:
   - `pendingPlan.cleared`
   - `messages.loaded`
   - `session.flushed`
   - `ack`
5. Add the equivalent queued-branch assertion if it can be done without brittle timing.
6. Reset perf tracking after the test so later tests do not inherit the handler.

**Verification:**

```bash
bun test packages/server-core/src/sessions/sendmessage-durability.test.ts
bun test packages/server-core/src/sessions/queued-message-now.test.ts
bun x tsc --noEmit --pretty false --project packages/server-core/tsconfig.json
```

**Agent prompt:**

```text
You own only the server-core send/ack performance evidence slice.

Start from the baseline commit that already added `session.sendMessage.accept` in SessionManager.
Add tests in `packages/server-core/src/sessions/sendmessage-durability.test.ts` that prove the new perf span emits the ack path metadata and marks while preserving the existing on-disk-before-ack durability contract.

Do not change browser, renderer, provider routing, or persistence format.
Do not weaken the existing durability assertions.

Return changed files, exact commands run, and whether queued-branch perf was covered or intentionally deferred.
```

### Agent B: Browser Resource Budget Policy

**Scope:** Electron main browser instance lifecycle only.

**Files:**
- Modify: `apps/electron/src/main/browser-pane-manager.ts`
- Modify: `apps/electron/src/main/__tests__/browser-pane-manager.test.ts`
- Optional: `packages/server-core/src/handlers/browser-pane-manager-interface.ts` only if a new public method is required.
- Avoid: `AppShell.tsx`, renderer browser UI, provider code.

**Goal:** Move from passive soft-budget logging to a safe resource policy that does not destroy session-owned or user-visible work.

**Allowed behavior change:**
- When creating above soft limit, safe cleanup may destroy only instances that are all of:
  - `ownerType === "manual"`
  - unbound
  - hidden
  - current URL is `about:blank` or browser empty-state page
  - not under agent control

**Forbidden behavior change:**
- Do not destroy session-owned browsers.
- Do not destroy visible browsers.
- Do not destroy a browser with a real navigated URL.
- Do not add a hard cap that rejects creation.

**Required steps:**

1. Add a private helper that identifies safe cleanup candidates.
2. Before logging over-budget creation, attempt safe cleanup.
3. Keep the warning if the count is still over budget after cleanup.
4. Add tests for:
   - safe hidden blank manual instances are cleaned up
   - session-owned instances are preserved
   - visible instances are preserved
   - real navigated URLs are preserved

**Verification:**

```bash
bun test apps/electron/src/main/__tests__/browser-pane-manager.test.ts
bun test apps/electron/src/main/__tests__/sessions-browser-release.test.ts
bun x tsc --noEmit --pretty false --project apps/electron/tsconfig.json
```

**Agent prompt:**

```text
You own only Electron main browser resource policy.

Start from the baseline commit that already added `CRAFT_BROWSER_INSTANCE_SOFT_LIMIT` and soft-budget logging.
Implement safe cleanup for over-budget browser instances, limited to hidden, unbound, manual, empty browsers. Preserve session-owned, visible, navigated, and agent-controlled browsers.

Do not touch AppShell, renderer browser UI, provider code, or session persistence.
Do not introduce a hard cap.

Return changed files, exact commands run, and a short table of which browser instance types are cleaned or preserved.
```

### Agent C: Chat Turn Grouping And Search Cost

**Scope:** Chat transcript grouping/search performance.

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
- Modify or create: `apps/electron/src/renderer/components/app-shell/ChatDisplay.search.ts`
- Modify or create tests under: `apps/electron/src/renderer/components/app-shell/__tests__/`
- Modify only if needed: `packages/ui/src/components/chat/turn-utils.ts`
- Tests: `packages/ui/src/components/chat/__tests__/*.test.ts`

**Goal:** Avoid redundant full transcript grouping during search/render and reduce avoidable O(n) checks in visible-turn rendering.

**Required steps:**

1. Extract pure search helpers from `ChatDisplay.tsx` if they are currently embedded.
2. Reuse the existing `allTurns` result instead of calling `groupMessagesByTurn(transcriptMessages)` again in search paths.
3. Convert `matchingTurnIds.includes(turnKey)` style render checks to a memoized `Set`.
4. Preserve reverse pagination behavior and sticky-bottom behavior.
5. Add tests for pure search helper behavior where possible; keep source-layout tests updated if they intentionally check source text.

**Verification:**

```bash
bun test packages/ui/src/components/chat/__tests__/turn-utils-grouping.test.ts
bun test packages/ui/src/components/chat/__tests__/turn-lifecycle.test.ts
bun test packages/ui/src/components/chat/__tests__/turn-utils-branching.test.ts
bun test apps/electron/src/main/__tests__/session-turn-grouping-parity.test.ts
bun test apps/electron/src/renderer/components/app-shell/__tests__/chat-display-layout.test.ts
bun x tsc --noEmit --pretty false --project apps/electron/tsconfig.json
```

**Agent prompt:**

```text
You own only ChatDisplay transcript grouping/search performance.

Find and remove redundant `groupMessagesByTurn(transcriptMessages)` calls inside ChatDisplay search/render logic. Use the existing memoized `allTurns` where possible, and convert repeated list membership checks to Set membership.

Do not touch AppShell, session persistence, browser manager, or method packs.
Do not alter visual layout, pagination, sticky-bottom behavior, or turn grouping semantics.

Return changed files, exact commands run, and before/after notes on how many full transcript grouping calls remain in ChatDisplay.
```

### Agent D: AppShell Novel Workflow First Extraction

**Scope:** Renderer AppShell novel workflow. This is the only Wave 1 agent allowed to edit `AppShell.tsx`.

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- Create: `apps/electron/src/renderer/hooks/useNovelReviewController.ts`
- Modify or create tests:
  - `apps/electron/src/renderer/lib/__tests__/novel-review-workflow.test.ts`
  - `apps/electron/src/renderer/components/writing/__tests__/novel-workspace-navigator.test.tsx`

**Goal:** Reduce AppShell coupling by extracting the smallest safe novel-review controller slice without changing UI or file IO behavior.

**First extraction only:**
- Move review status map ownership and derived pending review paths out of `AppShell`.
- Move next/previous review navigation helper wiring out of `AppShell`.
- Keep accept/reject file IO handlers in `AppShell` for this wave unless the extraction is trivial.

**Do not extract yet:**
- `ensureNovelDocumentSaved`
- autosave timers
- workspace version creation
- export handling
- provider/backend send behavior

**Required steps:**

1. Identify current AppShell variables for:
   - `novelReviewStatus`
   - pending changed file paths
   - selected file review changes
   - review navigation
2. Create `useNovelReviewController` with typed input/output.
3. Keep all existing callbacks stable with `React.useMemo`/`React.useCallback`.
4. Update `AppShell.tsx` to consume the hook.
5. Update existing source-contract tests only where the old inline source string is intentionally moved.

**Verification:**

```bash
bun test apps/electron/src/renderer/lib/__tests__/novel-review-workflow.test.ts
bun test apps/electron/src/renderer/components/writing/__tests__/novel-workspace-navigator.test.tsx
bun test apps/electron/src/renderer/components/app-shell/__tests__/layout-defaults.test.ts
bun x tsc --noEmit --pretty false --project apps/electron/tsconfig.json
```

**Agent prompt:**

```text
You are the only agent allowed to edit AppShell.tsx.

Extract the smallest safe novel review controller from AppShell into `apps/electron/src/renderer/hooks/useNovelReviewController.ts`. Move review status ownership, pending changed paths, selected-file review changes, and review navigation wiring. Keep accept/reject file IO, autosave, version creation, export, and send behavior in AppShell for this wave.

Do not change UI behavior. Do not touch session persistence, browser manager, ChatDisplay, provider routing, or method packs.

Return changed files, exact commands run, and a list of AppShell states/effects removed or left in place.
```

### Agent E: Formal Novel Product Surface Audit

**Scope:** Product-surface simplification and release-facing documentation. Prefer audit + narrow cleanup over deletion.

**Files:**
- Read: `README.md`
- Read: `packages/shared/src/writing/method-packs/index.ts`
- Read: `packages/shared/src/writing/method-packs/types.ts`
- Read tests under: `packages/shared/src/writing/__tests__/`
- Create: `docs/plans/2026-06-09-formal-novel-surface-audit.md`
- Modify code only if the audit finds a stale public label or dead transitional alias with test coverage.

**Goal:** Separate active formal-novel release surface from legacy/general workbench surface without breaking method-pack/provider orthogonality.

**Required steps:**

1. Inventory active user-facing surfaces:
   - Electron desktop
   - writing workspace
   - method packs
   - sources/skills/automations
   - viewer/webui/marketing/messaging gateway
2. Classify each as:
   - active release surface
   - experimental/internal
   - legacy/deferred
3. Identify which labels/docs make the product look broader than the formal-novel target.
4. Propose minimal changes with exact files and tests.
5. Do not delete method-pack IDs or provider routing unless tests prove they are dead and product owner confirms.

**Verification for doc-only audit:**

```bash
git diff --check
```

**Verification if code/docs are modified:**

```bash
bun test packages/shared/src/writing/__tests__/novel-template.test.ts
bun x tsc --noEmit --pretty false --project packages/shared/tsconfig.json
git diff --check
```

**Agent prompt:**

```text
You own only the formal-novel product surface audit.

Read README, method-pack registry/types, and writing method-pack tests. Produce `docs/plans/2026-06-09-formal-novel-surface-audit.md` that classifies active release surface versus experimental/internal/legacy surface. Suggest minimal cleanup, but do not delete method packs or change provider routing without explicit evidence and tests.

Do not touch AppShell, session persistence, browser manager, or ChatDisplay.

Return the audit file path, exact commands run, and the smallest code/doc changes you recommend for a later wave.
```

## Wave 2: Coordinator Integration

Run integration after all Wave 1 agents return.

**Steps:**

1. Review changed files from each agent. Reject or manually merge any file-domain violation.
2. Integrate in this order:
   - Agent A session tests
   - Agent B browser budget
   - Agent C chat grouping/search
   - Agent D AppShell novel review extraction
   - Agent E audit doc
3. Run targeted verification:

```bash
bun test packages/server-core/src/sessions/sendmessage-durability.test.ts
bun test packages/server-core/src/sessions/queued-message-now.test.ts
bun test apps/electron/src/main/__tests__/browser-pane-manager.test.ts
bun test apps/electron/src/main/__tests__/sessions-browser-release.test.ts
bun test packages/ui/src/components/chat/__tests__/turn-utils-grouping.test.ts
bun test packages/ui/src/components/chat/__tests__/turn-lifecycle.test.ts
bun test apps/electron/src/main/__tests__/session-turn-grouping-parity.test.ts
bun test apps/electron/src/renderer/lib/__tests__/novel-review-workflow.test.ts
bun test apps/electron/src/renderer/components/writing/__tests__/novel-workspace-navigator.test.tsx
bun x tsc --noEmit --pretty false --project packages/server-core/tsconfig.json
bun x tsc --noEmit --pretty false --project apps/electron/tsconfig.json
bun x tsc --noEmit --pretty false --project packages/shared/tsconfig.json
git diff --check
```

4. If targeted checks pass, run the repo release gate:

```bash
bun run validate:ci
```

5. Commit merged wave:

```bash
git add <integrated files>
git commit -m "perf: tighten session browser and chat workflow boundaries"
```

## Known Non-Parallel Work

Do not parallelize these until Wave 1 is integrated:

- Moving AppShell autosave/version creation out of `AppShell.tsx`.
- Changing session persistence format from full JSONL rewrite to append/snapshot.
- Hard-capping browser instance creation.
- Removing method packs or provider modes.

These are shared-state or product-boundary decisions, not independent parallel slices.

