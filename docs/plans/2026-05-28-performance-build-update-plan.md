# Performance, Build Speed, and Update Reminder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve Storyflow runtime responsiveness, Electron build speed, and update reminder reliability without mixing orthogonal concerns or destabilizing the release path.

**Architecture:** Treat build pipeline, updater UX, and runtime performance as separate axes with shared verification only at the end. Start with low-risk build/updater changes that have disjoint write sets, then add instrumentation before deeper runtime rewrites. Keep release safety checks intact; do not trade signing/notarization correctness for speed.

**Tech Stack:** Bun, TypeScript, Electron, electron-builder, electron-updater, Vite, React, Jotai, Bun test.

---

## Execution Topology

### Shared State

- `package.json` scripts define the build DAG and affect all packaging flows.
- `apps/electron/resources/**` and `apps/electron/dist/resources/**` are generated/staged resources; implementation must not duplicate or delete runtime-required assets.
- `RPC_CHANNELS.update.*`, `UpdateInfo`, and `window.electronAPI.*` are shared contracts between main and renderer.
- Runtime session state is split between server-core persistence, renderer Jotai atoms, and transport events. Changes here must be serialized after profiling because the blast radius is high.

### Parallel Decision

Run the first wave in parallel because the write sets are disjoint:

- **Agent A: Build pipeline dedupe**
  - Owns `package.json`, `scripts/electron-build-resources.ts`, `apps/electron/scripts/copy-assets.ts`, and build-config tests.
  - Must not touch updater or runtime session code.
- **Agent B: Update reminder reliability**
  - Owns `apps/electron/src/main/auto-update.ts`, `apps/electron/src/renderer/hooks/useUpdateChecker.ts`, `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx`, update-related i18n/tests.
  - Must not touch build scripts or session runtime.

Keep runtime performance work serial for now:

- It crosses renderer state, server persistence, transport, and watcher ownership.
- Current worktree already has user edits in renderer/server files near that area.
- The correct first step is instrumentation/profiling, not concurrent structural refactors.

Critical path:

1. Resource staging dedupe, because it is low risk and directly reduces build work.
2. Update reminder periodic/error-state improvement, because code already has the updater substrate.
3. Verification of both independent changes together.
4. Runtime profiling instrumentation.
5. Runtime rewrites based on measured bottlenecks.

---

### Task 1: Build Resource Staging Dedupe

**Files:**
- Modify: `package.json`
- Modify or verify: `scripts/electron-build-resources.ts`
- Modify or verify: `apps/electron/scripts/copy-assets.ts`
- Test: `scripts/build/electron-package-size-config.test.ts`

**Step 1: Write the failing test**

Add a regression assertion that the root `electron:build` script does not run two resource-copy steps.

```ts
test('electron build has a single resource staging step', () => {
  const rootPackage = JSON.parse(readRepoFile('package.json')) as {
    scripts: Record<string, string>
  }

  expect(rootPackage.scripts['electron:build']).not.toContain('electron:build:resources && bun run electron:build:assets')
  expect(rootPackage.scripts['electron:build']).toContain('electron:build:assets')
})
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test scripts/build/electron-package-size-config.test.ts
```

Expected: FAIL because `electron:build` currently includes both `electron:build:resources` and `electron:build:assets`.

**Step 3: Implement minimal build script change**

Change `electron:build` to run one final resource staging/copy step:

```json
"electron:build": "bun run electron:build:main && bun run electron:build:preload && bun run electron:build:renderer && bun run electron:build:assets"
```

Keep `electron:build:resources` available for direct/debug use unless a later cleanup proves it is dead.

**Step 4: Verify**

Run:

```bash
bun test scripts/build/electron-package-size-config.test.ts
bun run electron:build:assets
```

Expected: test passes; `apps/electron/dist/resources/session-mcp-server/index.js` and `apps/electron/dist/resources/pi-agent-server/index.js` exist after assets build.

**Step 5: Integration notes**

Do not remove `stageSubprocessResources()` from `copy-assets.ts` in this task unless the direct tests prove all subprocess resources still stage correctly through the remaining path.

---

### Task 2: CI Release Skip Duplicate Install

**Files:**
- Modify: `apps/electron/scripts/build-dmg.sh`
- Modify: `.github/workflows/release.yml`
- Test: `scripts/build/macos-release-config.test.ts`

**Step 1: Write the failing test**

Add release config assertions:

```ts
test('macOS release build can skip duplicate dependency install after CI install', () => {
  const buildScript = readRepoFile('apps/electron/scripts/build-dmg.sh')
  const workflow = readRepoFile('.github/workflows/release.yml')

  expect(buildScript).toContain('CRAFT_SKIP_INSTALL')
  expect(buildScript).toContain('bun install --frozen-lockfile')
  expect(workflow).toContain('CRAFT_SKIP_INSTALL: "1"')
})
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test scripts/build/macos-release-config.test.ts
```

Expected: FAIL because `CRAFT_SKIP_INSTALL` is not wired and build script uses bare `bun install`.

**Step 3: Implement minimal script change**

Wrap install in `build-dmg.sh`:

```bash
if [ "${CRAFT_SKIP_INSTALL:-}" = "1" ]; then
    echo "Skipping dependency install because CRAFT_SKIP_INSTALL=1"
else
    bun install --frozen-lockfile
fi
```

Set `CRAFT_SKIP_INSTALL: "1"` only in CI build jobs that already ran `bun install --frozen-lockfile`.

**Step 4: Verify**

Run:

```bash
bun test scripts/build/macos-release-config.test.ts
```

Expected: PASS.

**Step 5: Integration notes**

Do not set `CRAFT_SKIP_INSTALL=1` for local commands by default. Local builds should still self-heal missing dependencies unless the caller opts out explicitly.

---

### Task 3: Update Reminder Periodic Check and Error Visibility

**Files:**
- Modify: `apps/electron/src/main/auto-update.ts`
- Modify: `apps/electron/src/renderer/hooks/useUpdateChecker.ts`
- Modify: `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx`
- Modify: `packages/shared/src/i18n/locales/en.json`
- Modify: `packages/shared/src/i18n/locales/zh-Hans.json`
- Test: `apps/electron/src/renderer/lib/__tests__/update-indicator.test.ts` or a new focused hook helper test if logic is extracted

**Step 1: Write the failing test**

Extract a small pure helper from `useUpdateChecker` if needed:

```ts
export function shouldRunScheduledUpdateCheck(args: {
  now: number
  lastCheckedAt: number | null
  intervalMs: number
  isPackaged: boolean
}): boolean {
  if (!args.isPackaged) return false
  if (args.lastCheckedAt === null) return true
  return args.now - args.lastCheckedAt >= args.intervalMs
}
```

Test:

```ts
test('scheduled update checks are packaged-only and interval-gated', () => {
  expect(shouldRunScheduledUpdateCheck({
    now: 12 * 60 * 60 * 1000,
    lastCheckedAt: 0,
    intervalMs: 6 * 60 * 60 * 1000,
    isPackaged: true,
  })).toBe(true)

  expect(shouldRunScheduledUpdateCheck({
    now: 60 * 1000,
    lastCheckedAt: 0,
    intervalMs: 6 * 60 * 60 * 1000,
    isPackaged: true,
  })).toBe(false)

  expect(shouldRunScheduledUpdateCheck({
    now: 12 * 60 * 60 * 1000,
    lastCheckedAt: 0,
    intervalMs: 6 * 60 * 60 * 1000,
    isPackaged: false,
  })).toBe(false)
})
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test apps/electron/src/renderer/lib/__tests__/update-indicator.test.ts
```

Expected: FAIL until the helper exists.

**Step 3: Implement minimal updater UX change**

- Add low-frequency scheduled check in renderer only when Electron API is available and packaged/runtime check says it is allowed.
- Use a conservative interval: `6 * 60 * 60 * 1000`.
- Do not spam toasts while downloading; only toast when `downloadState === 'ready'`.
- Surface `updateInfo.error` in Settings About with a retry action.

**Step 4: Verify**

Run:

```bash
bun test apps/electron/src/renderer/lib/__tests__/update-indicator.test.ts
bun test apps/electron/src/renderer/pages/settings/__tests__/app-settings-update.test.tsx
```

If no existing page test exists, add one that renders the error row through the smallest stable component boundary.

**Step 5: Integration notes**

Do not move the updater feed from R2 to GitHub Releases. Current production contract is `https://story-storage.zjding.com/latest`.

---

### Task 4: Runtime Profiling Before Refactor

**Files:**
- Modify: `packages/server-core/src/handlers/rpc/files.ts`
- Modify: `packages/server-core/src/sessions/SessionManager.ts`
- Modify: `apps/electron/src/renderer/event-processor/handlers/text.ts`
- Test: existing focused tests for touched modules

**Step 1: Write focused tests for counters/logging boundaries**

Prefer pure helper tests over UI-heavy tests. Example helper:

```ts
export function summarizeFileSearchBatch(requestCount: number, rootCount: number) {
  return { requestCount, rootCount }
}
```

**Step 2: Implement instrumentation only**

Add debug-only timing around:

- `SEARCH_BATCH` request count, unique root count, duration.
- session persist queue serialize/write duration.
- renderer text delta event count per active session over a short window.

**Step 3: Verify**

Run:

```bash
bun test packages/server-core/src/handlers/rpc/files.write.test.ts
bun test packages/shared/src/sessions/__tests__/persistence-queue.test.ts
bun test apps/electron/src/renderer/event-processor/handlers/__tests__/text-message-id-sync.test.ts
```

**Step 4: Profiling command**

Run the app in debug mode:

```bash
CRAFT_DEBUG=1 bun run electron:dev 2>&1 | tee /tmp/storyflow-perf.log
```

Then exercise:

- 300+ message session switch.
- Long streaming response.
- Writing workspace open.
- `@` file search in a large workspace.

---

### Task 5: Streaming Renderer State Refactor

**Dependency:** Task 4 profiling must show renderer delta handling is a visible bottleneck.

**Files:**
- Modify: `apps/electron/src/renderer/atoms/sessions.ts`
- Modify: `apps/electron/src/renderer/event-processor/handlers/text.ts`
- Modify: `apps/electron/src/renderer/event-processor/helpers.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
- Test: renderer event-processor and atom tests.

**Implementation direction:**

- Introduce a per-session streaming atom keyed by `sessionId`.
- Keep committed messages stable during text deltas.
- Merge into `messages` only on final text completion.
- Maintain message indexes for `messageId`/`turnId` lookup when updating committed messages.
- Metadata updates must only fire for list-visible state changes.

**Verification:**

```bash
bun test apps/electron/src/renderer/atoms/__tests__/sessions.test.ts
bun test apps/electron/src/renderer/event-processor/handlers/__tests__/text-message-id-sync.test.ts
bun test apps/electron/src/renderer/lib/__tests__/session-load.test.ts
```

---

### Task 6: File Search Batch Index

**Dependency:** Task 4 profiling must show `SEARCH_BATCH` or writing workspace detection repeats directory scans enough to matter.

**Files:**
- Modify: `packages/server-core/src/handlers/rpc/files.ts`
- Test: add focused search batch tests near existing file RPC tests.

**Implementation direction:**

- Group batch requests by normalized base path.
- Build one bounded BFS snapshot per base path.
- Answer name/path queries from the snapshot.
- Keep direct exact path lookup fast.
- Add concurrency caps for large batches.

**Verification:**

```bash
bun test packages/server-core/src/handlers/rpc/files.write.test.ts
```

---

### Task 7: ConfigWatcher Ownership Split

**Dependency:** Do after file search/streaming work unless profiling shows watcher storms are the top bottleneck.

**Files:**
- Modify: `packages/shared/src/config/watcher.ts`
- Modify: `packages/server-core/src/sessions/SessionManager.ts`
- Test: watcher tests under `apps/electron/src/main/handlers/__tests__` and shared config watcher tests.

**Implementation direction:**

- Make global config/source/skill watchers singleton per process.
- Keep workspace-local watcher per workspace.
- Ensure global source/skill live refresh still works.
- Keep session metadata watcher separate from config watcher.

**Verification:**

```bash
bun test apps/electron/src/main/handlers/__tests__/session-watcher.test.ts
bun test apps/electron/src/main/handlers/__tests__/sessions-watchers.test.ts
```

---

## Final Verification

After integrating the first wave:

```bash
bun test scripts/build/electron-package-size-config.test.ts scripts/build/macos-release-config.test.ts
bun test apps/electron/src/renderer/lib/__tests__/update-indicator.test.ts
bun run typecheck:electron
```

Before claiming release-path readiness:

```bash
bun run electron:build
```

Do not run a full signed DMG build as routine verification unless the task explicitly changes release packaging output or credentials are available; use focused build and config tests first.
