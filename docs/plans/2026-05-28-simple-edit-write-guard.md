# Create-Only Write Contract Implementation Plan

**Goal:** Remove the normal path for accidental whole-file rewrites by making `write` create-only and routing existing-file changes through exact `edit` operations.

**Architecture:** Split file mutation by semantic operation. `write` creates files and fails if the path already exists. `edit` remains the only normal way to change existing files. Full replacement is not exposed as a casual path; if it is needed later, it should become an explicit `replace_file` operation with separate intent and review.

**Tech Stack:** TypeScript, Bun test, Pi SDK tool definitions, existing Electron diff/review surfaces.

---

## Non-Goals

- Do not add semantic search, vector retrieval, or a new editing plugin.
- Do not add ratio-based rewrite heuristics; thresholds are a guardrail, not the root contract.
- Do not change Claude/Codex backend tool contracts in this pass.
- Do not add `base_sha256` yet; add it only if stale-context edits remain observable after this contract change.

## Task 1: Make Pi `write` Create-Only

**Files:**
- Create: `packages/pi-agent-server/src/write-tool.ts`
- Create: `packages/pi-agent-server/src/write-tool.test.ts`
- Modify: `packages/pi-agent-server/src/index.ts`

**Behavior:**
- `write` to a missing path succeeds and may create parent directories.
- `write` to an existing path fails atomically before changing content.
- Error text tells the model to use `edit` with `edits[].oldText/newText`.

**Validation:**

```bash
bun test packages/pi-agent-server/src/write-tool.test.ts
```

## Task 2: Add File-Change Semantics To Review Data

**Files:**
- Modify: `packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx`
- Modify: `apps/electron/src/renderer/lib/file-changes.ts`
- Modify: `apps/electron/src/renderer/lib/__tests__/file-changes.test.ts`

**Behavior:**
- `Edit` changes are `changeKind: 'modify'`.
- successful create-only `Write` changes are `changeKind: 'create'`.
- legacy `Write` changes with captured previous content are `changeKind: 'replace'`.

**Validation:**

```bash
bun test apps/electron/src/renderer/lib/__tests__/file-changes.test.ts
```

## Task 3: Let Review Reject Created Files By Deleting Them

**Files:**
- Modify: `apps/electron/src/renderer/lib/file-change-review.ts`
- Modify: `apps/electron/src/renderer/lib/novel-review-undo.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- Modify related renderer tests.

**Behavior:**
- Rejecting a `create` change deletes the file only if current content still matches the reviewed created content.
- Rejecting a `modify` change keeps the existing exact reverse-replacement behavior.
- Rejecting a `replace` change restores captured previous content only when the full current file still matches the reviewed replacement.

**Validation:**

```bash
bun test apps/electron/src/renderer/lib/__tests__/file-change-review.test.ts apps/electron/src/renderer/lib/__tests__/novel-review-undo.test.ts
```

## Task 4: Add Workspace File Delete RPC

**Files:**
- Modify: `packages/shared/src/protocol/channels.ts`
- Modify: `packages/shared/src/protocol/routing.ts`
- Modify: `packages/server-core/src/handlers/rpc/files.ts`
- Modify: `apps/electron/src/transport/channel-map.ts`
- Modify: `apps/electron/src/shared/types.ts`

**Behavior:**
- Renderer can call `window.electronAPI.deleteFile(path)`.
- Server validates the path with the same workspace file boundary as read/write.
- Remote workspaces route delete to the workspace-owning server.

**Validation:**

```bash
bun test packages/server-core/src/handlers/rpc/files.write.test.ts apps/electron/src/shared/__tests__/ipc-channels.test.ts packages/shared/src/protocol/__tests__/routing.test.ts
```

## Final Verification

Run focused regression tests first:

```bash
bun test packages/pi-agent-server/src/write-tool.test.ts apps/electron/src/renderer/lib/__tests__/file-changes.test.ts apps/electron/src/renderer/lib/__tests__/file-change-review.test.ts apps/electron/src/renderer/lib/__tests__/novel-review-undo.test.ts packages/server-core/src/handlers/rpc/files.write.test.ts
```

Then run broader contract tests and whitespace hygiene:

```bash
bun test apps/electron/src/shared/__tests__/ipc-channels.test.ts packages/shared/src/protocol/__tests__/routing.test.ts apps/electron/src/renderer/components/writing/__tests__/novel-workspace-navigator.test.tsx
git diff --check
```
