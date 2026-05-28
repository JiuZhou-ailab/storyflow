# Electron Package Size Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce Storyflow desktop package bloat by preventing duplicated runtime resources, development files, and source maps from entering Electron release artifacts.

**Architecture:** Keep the packaged app rooted at `app/`, but make `app/dist/resources` the single packaged resources tree for Electron assets and subprocess bundles. Electron-builder platform file rules must be explicit allowlists so platform-specific excludes do not fall back to packaging the whole app directory.

**Tech Stack:** Bun tests, Electron Builder YAML config, Vite renderer build, Electron main runtime path setup.

---

### Task 1: Add package-size regression tests

**Files:**
- Create: `scripts/build/electron-package-size-config.test.ts`
- Modify: `packages/shared/src/agent/backend/__tests__/runtime-resolver.test.ts`
- Create: `apps/electron/src/main/__tests__/runtime-paths.test.ts`

**Steps:**
1. Add tests that parse `apps/electron/electron-builder.yml` and require explicit platform file allowlists.
2. Add tests that reject packaged source maps and top-level `resources/**/*` app inclusion.
3. Update runtime resolver expectations so `dist/resources` is the preferred packaged server location and `resources` remains legacy fallback.
4. Add a pure Electron runtime path test proving packaged CLI tools resolve from `app/dist/resources`.

### Task 2: Tighten Electron Builder package inputs

**Files:**
- Modify: `apps/electron/electron-builder.yml`

**Steps:**
1. Replace platform-specific negative-only file lists with explicit positive allowlists.
2. Keep platform-specific binary excludes, but do not include the top-level `resources` tree in app payload.
3. Preserve SDK/ripgrep/worker `extraResources` behavior.

### Task 3: Align runtime resources to one packaged tree

**Files:**
- Modify: `apps/electron/src/main/index.ts`
- Create: `apps/electron/src/main/runtime-paths.ts`
- Modify: `packages/shared/src/agent/backend/internal/runtime-resolver.ts`
- Modify: `packages/shared/src/agent/backend/__tests__/runtime-resolver.test.ts`

**Steps:**
1. Resolve packaged `CRAFT_RESOURCES_BASE`, `CRAFT_UV`, scripts, and wrapper `PATH` from `app/dist/resources`.
2. Keep `CRAFT_APP_ROOT` at `app/` so vendored Bun, SDK binaries, and app-root paths remain stable.
3. Prefer `dist/resources/<server>` in the packaged backend resolver, with `resources/<server>` fallback for older artifacts.

### Task 4: Disable production renderer source maps by default

**Files:**
- Modify: `apps/electron/vite.config.ts`

**Steps:**
1. Make renderer source maps opt-in via `CRAFT_RENDERER_SOURCEMAP=1`.
2. Keep the electron-builder `!**/*.map` guard as defense in depth.

### Task 5: Document decisions and verify

**Files:**
- Modify: `implementation-notes.md`

**Steps:**
1. Record the resource-root decision, expected size savings, and tradeoffs.
2. Run targeted tests for new package-size and runtime path coverage.
3. Run relevant broader checks if the targeted suite passes.
