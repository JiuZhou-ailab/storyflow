# Snapshot-Sourced Writing Review (Orthogonal what/who) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the writing-workspace review diff sound and complete by sourcing *what changed* from the git snapshot `base..head`, while keeping *who changed it* (agent vs user/external) from tool activity — two orthogonal axes joined into one review model.

**Architecture:** Today `reviewableNovelFileChanges` is reconstructed from `collectFileChangesFromActivities()` (Edit/Write payloads), and a `getWritingProjectBashWriteRedirect` Bash guard is load-bearing because activity reconstruction is blind to Bash/external writes. We invert the dependency: the snapshot diff (`compareWorkspaceVersions(base, head)`) becomes the *what-changed* truth, content is lazily fetched per commit (`git show commit:path`), and activity is demoted to its single remaining job — *attribution* (which changed paths the agent touched). The Bash guard then stops being load-bearing and is demoted to a soft hint. This removes the heuristic blocklist that could never be sound and makes the two concerns (state vs computation, content vs authorship) independently decidable.

**Tech Stack:** TypeScript, Electron (renderer + main RPC), `@craft-agent/server-core` git adapter, `@craft-agent/shared` writing domain, `@craft-agent/ui` `FileChange`/`MultiDiffPreviewOverlay`, `bun:test`.

---

## First Principles (why this shape)

1. **Soundness of "what changed" can only come from the filesystem.** In allow-all mode Bash can mutate files via redirects, `sed -i`, `mv`, scripts, or external processes; an `Edit` can be overwritten by a later `Bash`. Activity-derived diffs are therefore incomplete (miss writes) and unsound (stale after overwrite). `git base..head` is the only sound source.
2. **"Who changed it" can only come from activity.** A snapshot diff cannot distinguish an agent edit from the human editing the same manuscript in the side editor. Activity (tool calls) carries that authorship signal. This is the *one* thing the snapshot loses, and the existing code already relies on it (`novelAgentTouchedPathsRef`).
3. **These are orthogonal axes, not substitutes.** The review model is `snapshot(what) ⋈ activity(who)`. Collapsing them into one source (today: activity only; naive proposal: snapshot only) loses a dimension. We keep both and join.
4. **A heuristic guard cannot guarantee completeness.** `looksLikePotentialWrite` + `extractBashWriteTarget` are a pattern blocklist (bypassable by heredoc/`tee`/`python -c`/scripts). Relying on it for completeness is unsound by construction. Once snapshot is the truth, the guard is no longer required for correctness and becomes an early-warning nicety.
5. **Single responsibility / Occam.** Do NOT widen `compareWorkspaceVersions` to return file contents (it would conflate "list changes" with "read content", force `maxBuffer`/binary handling into the diff path). Add a separate `readWorkspaceFileAtCommit` and let the renderer fetch lazily.
6. **Centralize the reviewable predicate.** The `manuscript|outline|characters|locations|style|state|timeline` + `.md|.markdown|.txt` allowlist currently lives only inside `pre-tool-use.ts`. It is domain knowledge (long half-life) and must be a single source of truth shared by the guard AND the renderer, not duplicated.

---

## File Structure

**Create:**
- `apps/electron/src/renderer/lib/novel-snapshot-review.ts` — pure join: snapshot file-status diff + content fetchers + agent attribution → `{ reviewable: FileChange[]; external: WorkspaceVersionFileChange[] }`.
- `apps/electron/src/renderer/lib/__tests__/novel-snapshot-review.test.ts` — unit tests for the join (injected fetchers).
- `packages/server-core/src/services/__tests__/workspace-version-control.read-at-commit.test.ts` — tests for the new content primitive (or extend existing test file).

**Modify:**
- `packages/server-core/src/services/workspace-version-control.ts` — add `runGitRaw` + `readWorkspaceFileAtCommit`.
- `packages/server-core/src/handlers/rpc/system.ts` — register `git:readFileAtVersion` handler.
- `packages/shared/src/protocol/channels.ts` — add `git.READ_FILE_AT_VERSION`.
- `apps/electron/src/transport/channel-map.ts` — wire `readWorkspaceFileAtVersion`.
- `apps/electron/src/shared/types.ts` — add `readWorkspaceFileAtVersion` to the electronAPI type.
- `packages/shared/src/writing/file-categories.ts` — export `REVIEWABLE_WRITING_FILE_CATEGORIES` + `isReviewableWritingTextPath`.
- `packages/shared/src/agent/core/pre-tool-use.ts` — import the predicate instead of redefining it; later, demote the Bash guard.
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx` — switch `reviewableNovelFileChanges` to snapshot-sourced state; keep activity only for attribution; reject = three-way-safe revert.

---

## Task A: Sound content primitive (`readWorkspaceFileAtCommit`)

**Files:**
- Modify: `packages/server-core/src/services/workspace-version-control.ts`
- Test: `packages/server-core/src/services/__tests__/workspace-version-control.read-at-commit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// workspace-version-control.read-at-commit.test.ts
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'bun:test'
import { createWorkspaceVersion, readWorkspaceFileAtCommit } from '../workspace-version-control'

describe('readWorkspaceFileAtCommit', () => {
  it('returns file content at a given commit, untrimmed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      await writeFile(join(root, 'manuscript', 'ch1.md'), '# Title\n\nbody\n', { flag: 'w' }).catch(async () => {
        const { mkdir } = await import('fs/promises')
        await mkdir(join(root, 'manuscript'), { recursive: true })
        await writeFile(join(root, 'manuscript', 'ch1.md'), '# Title\n\nbody\n')
      })
      const v1 = await createWorkspaceVersion(root, { reason: 'manual' })
      await writeFile(join(root, 'manuscript', 'ch1.md'), '# Title\n\nCHANGED\n')
      await createWorkspaceVersion(root, { reason: 'manual' })

      const base = await readWorkspaceFileAtCommit(root, v1.commitHash!, 'manuscript/ch1.md')
      expect(base).toBe('# Title\n\nbody\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null for a path absent at that commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      const { mkdir } = await import('fs/promises')
      await mkdir(join(root, 'manuscript'), { recursive: true })
      await writeFile(join(root, 'manuscript', 'ch1.md'), 'x\n')
      const v1 = await createWorkspaceVersion(root, { reason: 'manual' })
      expect(await readWorkspaceFileAtCommit(root, v1.commitHash!, 'manuscript/ghost.md')).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server-core && bun test src/services/__tests__/workspace-version-control.read-at-commit.test.ts`
Expected: FAIL — `readWorkspaceFileAtCommit is not a function`.

- [ ] **Step 3: Implement `runGitRaw` + `readWorkspaceFileAtCommit`**

Add after `runGit` (note: `runGit` trims, which corrupts file bodies — content needs a raw variant with a larger buffer):

```ts
async function runGitRaw(rootPath: string, args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: rootPath,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve(stdout)
    })
  })
}

/**
 * Read a single file's text content as of a commit. Returns null when the path
 * is absent at that commit or the content is binary. Path must be repo-relative
 * with forward slashes.
 */
export async function readWorkspaceFileAtCommit(
  rootPath: string,
  commit: string,
  relativePath: string,
): Promise<string | null> {
  if (!await isGitRepo(rootPath)) return null
  try {
    const content = await runGitRaw(rootPath, ['show', `${commit}:${relativePath}`])
    if (content.includes('\u0000')) return null // binary guard
    return content
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server-core && bun test src/services/__tests__/workspace-version-control.read-at-commit.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server-core/src/services/workspace-version-control.ts packages/server-core/src/services/__tests__/workspace-version-control.read-at-commit.test.ts
git commit -m "feat: add readWorkspaceFileAtCommit content primitive"
```

---

## Task B: Expose the primitive over RPC

**Files:**
- Modify: `packages/shared/src/protocol/channels.ts:343-350` (git block)
- Modify: `packages/server-core/src/handlers/rpc/system.ts:223-241`
- Modify: `apps/electron/src/transport/channel-map.ts:98-102`
- Modify: `apps/electron/src/shared/types.ts:430-433`

- [ ] **Step 1: Add the channel constant**

In `channels.ts`, inside the `git: { ... }` object, add:

```ts
    READ_FILE_AT_VERSION: 'git:readFileAtVersion',
```

- [ ] **Step 2: Register the handler**

In `system.ts`, import `readWorkspaceFileAtCommit` alongside the other version-control imports, then add after the `RESTORE_VERSION` handler:

```ts
  server.handle(RPC_CHANNELS.git.READ_FILE_AT_VERSION, async (ctx, rootPath: string, commit: string, relativePath: string) => {
    const safeRoot = await validateWorkspaceRoot(ctx, rootPath)
    return readWorkspaceFileAtCommit(safeRoot, commit, relativePath)
  })
```

- [ ] **Step 3: Wire the renderer transport**

In `channel-map.ts`, in the same block as `compareWorkspaceVersions`:

```ts
  readWorkspaceFileAtVersion: invoke(RPC_CHANNELS.git.READ_FILE_AT_VERSION),
```

- [ ] **Step 4: Add the electronAPI type**

In `types.ts`, next to `compareWorkspaceVersions`:

```ts
  readWorkspaceFileAtVersion(rootPath: string, commit: string, relativePath: string): Promise<string | null>
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/shared && bun run tsc --noEmit` then `cd apps/electron && bun run tsc --noEmit` (renderer/main project as configured).
Expected: no new errors. If `validateWorkspaceRoot` import already present in `system.ts`, no extra import needed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/protocol/channels.ts packages/server-core/src/handlers/rpc/system.ts apps/electron/src/transport/channel-map.ts apps/electron/src/shared/types.ts
git commit -m "feat: expose readWorkspaceFileAtVersion over RPC"
```

---

## Task C: Centralize the reviewable-path predicate (kill the duplicate allowlist)

**Files:**
- Modify: `packages/shared/src/writing/file-categories.ts`
- Modify: `packages/shared/src/agent/core/pre-tool-use.ts:580-594`
- Test: `packages/shared/src/writing/__tests__/file-categories.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `file-categories.test.ts`:

```ts
import { isReviewableWritingTextPath } from '../file-categories'

describe('isReviewableWritingTextPath', () => {
  it('accepts manuscript markdown', () => {
    expect(isReviewableWritingTextPath('manuscript/ch1.md')).toBe(true)
  })
  it('rejects scratch and non-text', () => {
    expect(isReviewableWritingTextPath('.work/scratch.md')).toBe(false)
    expect(isReviewableWritingTextPath('manuscript/cover.png')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/writing/__tests__/file-categories.test.ts`
Expected: FAIL — `isReviewableWritingTextPath is not exported`.

- [ ] **Step 3: Move the predicate into the domain module**

In `file-categories.ts`, add (using the existing `categorizeNovelPath` + `WritingFileCategory`):

```ts
export const REVIEWABLE_WRITING_FILE_CATEGORIES = new Set<WritingFileCategory>([
  'manuscript',
  'outline',
  'characters',
  'locations',
  'style',
  'state',
  'timeline',
])

/** A writing-workspace text file whose changes the review UI should surface. */
export function isReviewableWritingTextPath(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/')
  if (!/\.(?:md|markdown|txt)$/i.test(normalizedPath)) return false
  return REVIEWABLE_WRITING_FILE_CATEGORIES.has(categorizeNovelPath(normalizedPath))
}
```

- [ ] **Step 4: Delete the duplicate from `pre-tool-use.ts` and import it**

In `pre-tool-use.ts`, remove the local `REVIEWABLE_WRITING_FILE_CATEGORIES` (lines ~580-588) and `isReviewableWritingTextPath` (lines ~590-594), and extend the existing import:

```ts
import { categorizeNovelPath, isReviewableWritingTextPath } from '../../writing/file-categories.ts';
import type { WritingFileCategory } from '../../writing/file-categories.ts';
```

(Drop `WritingFileCategory` if no longer referenced elsewhere in the file.)

- [ ] **Step 5: Run tests to verify pass**

Run: `cd packages/shared && bun test src/writing/__tests__/file-categories.test.ts && bun run tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/writing/file-categories.ts packages/shared/src/agent/core/pre-tool-use.ts packages/shared/src/writing/__tests__/file-categories.test.ts
git commit -m "refactor: single source of truth for reviewable writing paths"
```

---

## Task D: The orthogonal join (`buildSnapshotReviewChanges`)

**Files:**
- Create: `apps/electron/src/renderer/lib/novel-snapshot-review.ts`
- Test: `apps/electron/src/renderer/lib/__tests__/novel-snapshot-review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// novel-snapshot-review.test.ts
import { describe, expect, it } from 'bun:test'
import { buildSnapshotReviewChanges } from '../novel-snapshot-review'

const root = '/ws'
const toAbs = (rel: string) => `${root}/${rel}`

it('joins snapshot diff with agent attribution and fetches content lazily', async () => {
  const result = await buildSnapshotReviewChanges({
    fileChanges: [
      { path: 'manuscript/ch1.md', status: 'modified' },
      { path: 'manuscript/ch2.md', status: 'modified' }, // user-edited, not agent
      { path: 'manuscript/cover.png', status: 'modified' }, // not reviewable text
    ],
    baseCommit: 'BASE',
    rootPath: root,
    agentTouchedRelativePaths: new Set(['manuscript/ch1.md']),
    fetchAtCommit: async (_commit, rel) => (rel === 'manuscript/ch1.md' ? 'old1\n' : null),
    readDisk: async (abs) => (abs === '/ws/manuscript/ch1.md' ? 'new1\n' : null),
    toAbsolutePath: toAbs,
  })

  expect(result.reviewable).toEqual([
    {
      id: 'snapshot:manuscript/ch1.md',
      filePath: '/ws/manuscript/ch1.md',
      toolType: 'Edit',
      changeKind: 'modify',
      original: 'old1\n',
      modified: 'new1\n',
    },
  ])
  expect(result.external.map(c => c.path)).toEqual(['manuscript/ch2.md'])
})

it('handles added/deleted/renamed', async () => {
  const result = await buildSnapshotReviewChanges({
    fileChanges: [
      { path: 'outline/new.md', status: 'added' },
      { path: 'outline/gone.md', status: 'deleted' },
      { path: 'outline/after.md', status: 'renamed', previousPath: 'outline/before.md' },
    ],
    baseCommit: 'BASE',
    rootPath: root,
    agentTouchedRelativePaths: new Set(['outline/new.md', 'outline/gone.md', 'outline/after.md']),
    fetchAtCommit: async (_c, rel) =>
      rel === 'outline/gone.md' ? 'goneOld\n' : rel === 'outline/before.md' ? 'renOld\n' : null,
    readDisk: async (abs) =>
      abs === '/ws/outline/new.md' ? 'newBody\n' : abs === '/ws/outline/after.md' ? 'renNew\n' : null,
    toAbsolutePath: toAbs,
  })

  const byId = Object.fromEntries(result.reviewable.map(c => [c.id, c]))
  expect(byId['snapshot:outline/new.md']).toMatchObject({ original: '', modified: 'newBody\n', changeKind: 'create', toolType: 'Write' })
  expect(byId['snapshot:outline/gone.md']).toMatchObject({ original: 'goneOld\n', modified: '', changeKind: 'replace' })
  expect(byId['snapshot:outline/after.md']).toMatchObject({ original: 'renOld\n', modified: 'renNew\n', changeKind: 'modify' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/electron && bun test src/renderer/lib/__tests__/novel-snapshot-review.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure join**

```ts
// input: Snapshot file-status diff, content fetchers, and agent attribution set.
// output: Reviewable FileChange[] (agent-attributed) plus the external-change list.
// pos: Pure join of workspace snapshot (what changed) and activity (who changed).

import type { FileChange } from '@craft-agent/ui'
import { isReviewableWritingTextPath } from '@craft-agent/shared/writing/file-categories'
import type { WorkspaceVersionFileChange } from '@/shared/types'

export interface SnapshotReviewInput {
  fileChanges: WorkspaceVersionFileChange[]
  baseCommit: string
  rootPath: string
  agentTouchedRelativePaths: Set<string>
  fetchAtCommit: (commit: string, relativePath: string) => Promise<string | null>
  readDisk: (absolutePath: string) => Promise<string | null>
  toAbsolutePath: (relativePath: string) => string
}

export interface SnapshotReviewResult {
  reviewable: FileChange[]
  external: WorkspaceVersionFileChange[]
}

function statusToChangeKind(status: WorkspaceVersionFileChange['status']): FileChange['changeKind'] {
  if (status === 'added') return 'create'
  if (status === 'deleted') return 'replace'
  return 'modify'
}

export async function buildSnapshotReviewChanges(input: SnapshotReviewInput): Promise<SnapshotReviewResult> {
  const reviewable: FileChange[] = []
  const external: WorkspaceVersionFileChange[] = []

  for (const change of input.fileChanges) {
    if (!isReviewableWritingTextPath(change.path)) continue

    if (!input.agentTouchedRelativePaths.has(change.path)) {
      external.push(change)
      continue
    }

    const basePath = change.status === 'renamed' && change.previousPath ? change.previousPath : change.path
    const original = change.status === 'added'
      ? ''
      : (await input.fetchAtCommit(input.baseCommit, basePath)) ?? ''
    const modified = change.status === 'deleted'
      ? ''
      : (await input.readDisk(input.toAbsolutePath(change.path))) ?? ''

    reviewable.push({
      id: `snapshot:${change.path}`,
      filePath: input.toAbsolutePath(change.path),
      toolType: change.status === 'added' ? 'Write' : 'Edit',
      changeKind: statusToChangeKind(change.status),
      original,
      modified,
    })
  }

  return { reviewable, external }
}
```

> Note: import path `@craft-agent/shared/writing/file-categories` must match the package's subpath export added in Task C; if the package only exposes a barrel, import from `@craft-agent/shared` instead. Verify against `packages/shared/src/index.ts` before running.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/electron && bun test src/renderer/lib/__tests__/novel-snapshot-review.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/renderer/lib/novel-snapshot-review.ts apps/electron/src/renderer/lib/__tests__/novel-snapshot-review.test.ts
git commit -m "feat: snapshot+activity orthogonal join for writing review"
```

---

## Task E: Wire AppShell — review diff from snapshot, attribution from activity

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (`latestNovelFileChanges` ~1748, `reviewableNovelFileChanges` ~2015, `checkpointNovelWorkspaceAgentTurn` ~2277, `prepareNovelWorkspaceBriefForSend` ~2243)

This is integration wiring; verify with the existing renderer test harness (`novel-workspace-navigator.test.tsx`) plus manual run. Keep changes minimal and behavior-preserving for the accept/reject UI (it keys off `original`/`modified`, which snapshot changes now populate).

- [ ] **Step 1: Add snapshot-review state; keep activity for attribution only**

Replace the `reviewableNovelFileChanges` memo (~2015) with React state and a ref:

```ts
const [reviewableNovelFileChanges, setReviewableNovelFileChanges] = React.useState<FileChange[]>([])
```

Keep `latestNovelFileChanges` (the `collectFileChangesFromActivities` memo at ~1748) — it is now used ONLY to derive agent-touched attribution, not for the review UI. Rename for clarity:

```ts
const agentActivityFileChanges = latestNovelFileChanges // attribution source only
```

- [ ] **Step 2: Compute the snapshot review inside the agent-turn checkpoint**

Rewrite `checkpointNovelWorkspaceAgentTurn` (~2277) to compute `base..head` and join. `base` is the last known commit (the pre-send snapshot); `head` is the agent-turn snapshot just created:

```ts
const checkpointNovelWorkspaceAgentTurn = React.useCallback(async (sessionId: string): Promise<void> => {
  if (!novelWorkspaceRoot || novelAgentTurnCheckpointInFlightRef.current) return

  const agentTouched = collectAgentTouchedRelativePaths(
    agentActivityFileChanges,
    novelWorkspaceRoot,
    novelWorkspaceFiles,
  )

  novelAgentTurnCheckpointInFlightRef.current = true
  try {
    const baseCommit = getKnownWorkspaceCommit(novelWorkspaceRoot, sessionId)
    const snapshot = await window.electronAPI.createWorkspaceVersion(novelWorkspaceRoot, { reason: 'agent-turn' })
    const headCommit = snapshot.commitHash

    if (baseCommit && headCommit && baseCommit !== headCommit) {
      const fileChanges = await window.electronAPI.compareWorkspaceVersions(novelWorkspaceRoot, baseCommit, headCommit)
      const { reviewable } = await buildSnapshotReviewChanges({
        fileChanges,
        baseCommit,
        rootPath: novelWorkspaceRoot,
        agentTouchedRelativePaths: new Set(agentTouched),
        fetchAtCommit: (commit, rel) => window.electronAPI.readWorkspaceFileAtVersion(novelWorkspaceRoot, commit, rel),
        readDisk: (abs) => window.electronAPI.readFile(abs).catch(() => null),
        toAbsolutePath: (rel) => joinNovelWorkspacePath(novelWorkspaceRoot, rel),
      })
      setReviewableNovelFileChanges(reviewable)
      setKnownWorkspaceCommit(novelWorkspaceRoot, sessionId, headCommit)
    }

    if (novelVersionDialogOpen) await refreshNovelVersions()
  } catch (error) {
    console.warn('[writing] Failed to compute snapshot review:', error)
  } finally {
    novelAgentTurnCheckpointInFlightRef.current = false
  }
}, [agentActivityFileChanges, novelVersionDialogOpen, novelWorkspaceFiles, novelWorkspaceRoot, refreshNovelVersions])
```

Add the import at the top of AppShell:

```ts
import { buildSnapshotReviewChanges } from '@/lib/novel-snapshot-review'
```

Use the existing relative→absolute join helper (`joinNovelWorkspacePath` or the local equivalent used by `normalizeNovelFileChangePaths`); if none is exported, derive `toAbsolutePath` from `novelWorkspaceFiles` (`relativePath`→`path`) with a fallback to `${root}/${rel}`.

- [ ] **Step 3: Repoint the freshness brief at the same join's `external` slice**

In `prepareNovelWorkspaceBriefForSend` (~2243), the pre-send freshness brief continues to use `compareWorkspaceVersions(previousCommit, headCommit)` but now filters via the shared predicate and `external` semantics (changes NOT attributed to the agent). The existing `unknownChanges = changedFiles.filter(c => !agentTouchedPaths.has(c.path))` already matches this; keep it but route paths through `isReviewableWritingTextPath` so non-reviewable churn is excluded. (No structural change required — only ensure the brief and the review share the predicate.)

- [ ] **Step 4: Drop `novelAgentTouchedPathsRef` if now redundant**

Attribution is computed inline in Step 2 from `agentActivityFileChanges`. If `novelAgentTouchedPathsRef` is no longer read elsewhere, remove it and its assignment. Otherwise leave it.

- [ ] **Step 5: Typecheck + existing renderer tests**

Run: `cd apps/electron && bun run tsc --noEmit && bun test src/renderer/components/writing/__tests__/novel-workspace-navigator.test.tsx`
Expected: no type errors; existing navigator tests pass (update any assertion that hard-coded activity-sourced changes).

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/AppShell.tsx
git commit -m "feat: writing review diff sourced from workspace snapshot"
```

---

## Task F: Three-way-safe reject (revert a reviewed file to base)

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (reject handler near the review-status block ~2492-2618)

Reject must restore the file to its **base** content (the `original` we presented) — but only if the file on disk still equals the `modified` we showed. If the user (or a later turn) changed it in between, the presented diff is stale; block rather than clobber.

- [ ] **Step 1: Implement the guarded reject**

```ts
const rejectNovelFileChange = React.useCallback(async (change: FileChange): Promise<boolean> => {
  if (!novelWorkspaceRoot) return false
  try {
    const current = await window.electronAPI.readFile(change.filePath).catch(() => null)
    if (current !== change.modified) {
      toast.error(t(
        'writing.review.rejectStale',
        'This file changed since the review was generated. Refresh before rejecting.'
      ))
      return false
    }
    await window.electronAPI.writeFile(change.filePath, change.original)
    if (selectedNovelFile?.path === change.filePath) {
      setNovelDocumentContent(change.original)
      setSavedNovelDocumentContent(change.original)
    }
    return true
  } catch (error) {
    toast.error(t('writing.review.rejectFailed', 'Failed to reject this change'), {
      description: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}, [novelWorkspaceRoot, selectedNovelFile?.path, t])
```

Add `writing.review.rejectStale` and `writing.review.rejectFailed` keys to `en.json`, `es.json`, `zh-Hans.json` (alphabetical, per shared i18n rules).

- [ ] **Step 2: Mark status only after a successful revert**

Wire `rejectNovelFileChange` into the existing reject action so the review-status map is set to `'rejected'` (via `getNovelReviewChangeKey`) only when the revert returns `true`.

- [ ] **Step 3: Typecheck + i18n validation**

Run: `cd apps/electron && bun run tsc --noEmit` and `bun run validate:ci` (or `bun run lint:i18n:parity`) from repo root.
Expected: no type errors; i18n parity/coverage pass.

- [ ] **Step 4: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/AppShell.tsx packages/shared/src/i18n/locales/*.json
git commit -m "feat: three-way-safe reject for writing review changes"
```

---

## Task G: Demote the Bash guard (now redundant for completeness)

**Files:**
- Modify: `packages/shared/src/agent/core/pre-tool-use.ts:866-872`
- Test: extend the pre-tool-use / writing test suite

Only do this AFTER Task E is verified end-to-end. Snapshot diff now guarantees completeness regardless of how the file was written, so the guard no longer needs to hard-block — keep it as an opt-in soft hint (or remove). The decisive proof is a test showing a Bash-written manuscript still appears in review.

- [ ] **Step 1: Add a regression test proving snapshot catches Bash writes**

Add a server-core integration test: create base snapshot, mutate `manuscript/ch1.md` directly on disk (simulating a Bash write — i.e. `writeFile`, no Edit activity), create head snapshot, assert `compareWorkspaceVersions(base, head)` includes the file and `readWorkspaceFileAtCommit` returns base content. This is the invariant that lets the guard relax.

```ts
it('snapshot diff catches a direct (Bash-style) write with no Edit activity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-bash-'))
  try {
    const { mkdir } = await import('fs/promises')
    await mkdir(join(root, 'manuscript'), { recursive: true })
    await writeFile(join(root, 'manuscript', 'ch1.md'), 'before\n')
    const base = await createWorkspaceVersion(root, { reason: 'user-preprompt' })
    await writeFile(join(root, 'manuscript', 'ch1.md'), 'after-via-bash\n') // no Edit tool involved
    const head = await createWorkspaceVersion(root, { reason: 'agent-turn' })

    const diff = await compareWorkspaceVersions(root, base.commitHash!, head.commitHash!)
    expect(diff.map(c => c.path)).toContain('manuscript/ch1.md')
    expect(await readWorkspaceFileAtCommit(root, base.commitHash!, 'manuscript/ch1.md')).toBe('before\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run it (should already pass — it validates the new truth source)**

Run: `cd packages/server-core && bun test src/services/__tests__/workspace-version-control.read-at-commit.test.ts`
Expected: PASS.

- [ ] **Step 3: Relax the guard from block to hint**

In `pre-tool-use.ts` step 5b (~866), change the writing-project Bash redirect from `return { type: 'block', ... }` to a non-blocking path (e.g. `onDebug?.(...)` only, or behind a feature flag defaulting to off). Update `getWritingProjectBashWriteRedirect`'s doc comment to state it is now a hint, not a completeness mechanism — the snapshot is.

- [ ] **Step 4: Update guard tests**

Adjust any test asserting Bash writes to manuscript paths are blocked to assert allow (or hint), since completeness no longer depends on blocking.

Run: `cd packages/shared && bun test` and `cd packages/server-core && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/agent/core/pre-tool-use.ts packages/server-core/src/services/__tests__/workspace-version-control.read-at-commit.test.ts
git commit -m "refactor: demote writing Bash guard to a soft hint (snapshot owns completeness)"
```

---

## Suggested commit order (recap)

1. `feat: add readWorkspaceFileAtCommit content primitive` (Task A)
2. `feat: expose readWorkspaceFileAtVersion over RPC` (Task B)
3. `refactor: single source of truth for reviewable writing paths` (Task C)
4. `feat: snapshot+activity orthogonal join for writing review` (Task D)
5. `feat: writing review diff sourced from workspace snapshot` (Task E)
6. `feat: three-way-safe reject for writing review changes` (Task F)
7. `refactor: demote writing Bash guard to a soft hint` (Task G)

## Manual integration verification (after Task E/F)

- Unrestricted/allow-all mode: have the agent write a manuscript chapter via `Bash` (e.g. heredoc) → after the turn, the file MUST appear in the review diff (proves snapshot, not activity, is the truth).
- Agent edits a chapter via `Edit` → same review path, correct old/new content.
- User edits a chapter in the side editor mid-session, agent does not touch it → it appears as `external` (freshness brief), NOT as a reviewable agent change (proves attribution axis survives).
- Reject a reviewed chapter → file reverts to base content; rejecting after a manual edit is blocked with the stale toast.

## Out of scope (YAGNI for v1)

- Hunk-level accept/reject (file-level only).
- Rename rendering as a move in the diff overlay (data layer already carries `renamed` + `previousPath`; UI can show delete+create until a dedicated renderer lands).
- Replacing the enumerated reviewable-category allowlist with a derived rule — acceptable for v1 now that it is centralized; revisit if the list keeps growing (its failure condition: a new content category that must be reviewed but is not in the set).
