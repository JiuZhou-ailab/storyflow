# Recent Code Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the recent release, marketing, and writing-profile changes without changing public behavior.

**Architecture:** Keep release asset naming as a small explicit contract shared by R2 upload and marketing downloads. Keep Work Profile migration incremental: remove dead prompt-injection plumbing only when the current compatibility surface is proven unnecessary, and defer broad Method Pack directory renames.

**Tech Stack:** TypeScript, React, Vite, Bun test runner, GitHub Actions release workflow.

---

## Constraints

- Do not touch unrelated dirty files already present in the worktree.
- Use `bun`, not npm or pnpm.
- Preserve public download URLs and release artifact names.
- Preserve current short-form workspace behavior: runtime writing rules live in `AGENTS.md` and local skills, not system prompt injection.
- Prefer small, reversible changes over broad renames.

## Task 1: Finish Marketing Download Simplification

**Files:**
- Keep: `scripts/build-marketing.ts`
- Modify: `package.json`
- Modify: `apps/marketing/package.json`
- Modify: `apps/marketing/vite.config.ts`
- Modify: `apps/marketing/src/App.tsx`
- Modify: `apps/marketing/src/downloads.ts`
- Modify: `apps/marketing/src/__tests__/downloads.test.ts`

**Steps:**
1. Add a failing test that proves download rendering does not depend on `downloadOptions` array order.
2. Replace `downloadOptions[2]` usage with direct rendering from the configured options.
3. Narrow `DownloadOption.platform` to `"macOS" | "Windows"`.
4. Keep the Bun production build script unless Vite build is proven reliable in this workspace.
5. Run:

```bash
bun test apps/marketing/src/__tests__/downloads.test.ts
bun run marketing:build
cd apps/marketing && bun run build
cd apps/marketing && bun run typecheck
```

## Task 2: Centralize Release Asset Contract

**Files:**
- Create: `scripts/release-assets.ts`
- Modify: `scripts/upload-r2-release-assets.ts`
- Modify: `scripts/upload-r2-release-assets.test.ts`
- Modify: `apps/marketing/src/downloads.ts`
- Modify: `apps/marketing/src/__tests__/downloads.test.ts`

**Steps:**
1. Add a small release contract module exporting required public assets, installer download options, and manifest file names.
2. Update the R2 upload script and marketing downloads to derive from that contract.
3. Keep GitHub Actions shell `grep` checks explicit unless the workflow can consume the contract without making CI harder to read.
4. Run:

```bash
bun test scripts/upload-r2-release-assets.test.ts apps/marketing/src/__tests__/downloads.test.ts scripts/build/macos-release-config.test.ts
bun run marketing:build
```

## Task 3: Remove Prompt Empty-Function Plumbing If Safe

**Files:**
- Potentially modify: `packages/shared/src/prompts/system.ts`
- Potentially modify: `packages/shared/src/agent/core/prompt-builder.ts`
- Potentially modify: `packages/shared/src/prompts/__tests__/system-novel.test.ts`
- Potentially modify: `packages/shared/src/agent/core/__tests__/prompt-builder-method-pack-reminder.test.ts`

**Steps:**
1. Confirm all remaining call sites are compatibility-only.
2. If safe, remove the always-empty helper functions and their call sites.
3. Keep tests that verify Method Pack runtime and periodic reminder prompt tags are absent from final prompts.
4. Run:

```bash
bun test packages/shared/src/prompts/__tests__/system-novel.test.ts packages/shared/src/agent/core/__tests__/prompt-builder-method-pack-reminder.test.ts
cd packages/shared && bun run tsc --noEmit
```

## Task 4: Decide WorkspaceProfile Naming Scope

**Files:**
- Potentially modify: `packages/shared/src/writing/method-packs/types.ts`
- Potentially modify: `packages/shared/src/writing/method-packs/index.ts`
- Potentially modify: `packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts`

**Steps:**
1. Reconcile with `docs/plans/2026-05-21-work-profile-refactor.md`, which explicitly defers broad naming migration.
2. If only aliases exist and no new call sites depend on `WorkspaceProfile`, keep them as a documented transition surface.
3. If adding a comment materially clarifies the boundary, add only that comment and keep tests unchanged.
4. Run:

```bash
bun test packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
cd packages/shared && bun run tsc --noEmit
```

## Task 5: Final Integration Verification

**Steps:**
1. Review diff boundaries and ensure unrelated dirty files are untouched.
2. Run the focused test set for changed areas.
3. Run package typechecks affected by changed files.
4. Summarize changes, verification, and any deferred items.
