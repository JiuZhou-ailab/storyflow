import { describe, expect, it } from 'bun:test'
import {
  buildRevertOperation,
  buildSnapshotRevertPlan,
  excludeUserSavedSnapshotChanges,
  getSnapshotChangeKind,
  type FileRevertPlan,
} from '../snapshot-revert'

const FILE = '/workspace/manuscript/ch1.md'

function plan(expected: string | null, target: string | null): FileRevertPlan {
  return { filePath: FILE, expected, target }
}

describe('buildRevertOperation', () => {
  it('restores the base content when the file still matches the reviewed result', () => {
    const result = buildRevertOperation(plan('agent version\n', 'human version\n'), 'agent version\n')
    expect(result).toEqual({ ok: true, operation: 'write', content: 'human version\n' })
  })

  it('deletes the file when the agent created it and it is untouched since', () => {
    const result = buildRevertOperation(plan('brand new\n', null), 'brand new\n')
    expect(result).toEqual({ ok: true, operation: 'delete' })
  })

  it('recreates the file when the agent deleted it', () => {
    const result = buildRevertOperation(plan(null, 'restored content\n'), null)
    expect(result).toEqual({ ok: true, operation: 'write', content: 'restored content\n' })
  })

  it('reports a conflict when the human edited the file after the change landed', () => {
    const result = buildRevertOperation(plan('agent version\n', 'human version\n'), 'edited by hand\n')
    expect(result).toEqual({ ok: false, reason: 'conflict' })
  })

  it('reports a conflict when a later turn overwrote the reviewed result', () => {
    const result = buildRevertOperation(plan('turn one\n', 'original\n'), 'turn two\n')
    expect(result).toEqual({ ok: false, reason: 'conflict' })
  })

  it('reports a conflict when the file was deleted after the change landed', () => {
    const result = buildRevertOperation(plan('agent version\n', 'original\n'), null)
    expect(result).toEqual({ ok: false, reason: 'conflict' })
  })

  it('reports a conflict when a created file was expected absent but now exists', () => {
    const result = buildRevertOperation(plan(null, 'restored\n'), 'someone recreated it\n')
    expect(result).toEqual({ ok: false, reason: 'conflict' })
  })

  it('treats an empty file as distinct from an absent file', () => {
    // Emptying a file is a real change; reverting it must restore the content.
    expect(buildRevertOperation(plan('', 'had content\n'), '')).toEqual({
      ok: true,
      operation: 'write',
      content: 'had content\n',
    })

    // An empty current file must not satisfy an "expected absent" plan.
    expect(buildRevertOperation(plan(null, 'restored\n'), '')).toEqual({ ok: false, reason: 'conflict' })

    // An absent current file must not satisfy an "expected empty" plan.
    expect(buildRevertOperation(plan('', 'had content\n'), null)).toEqual({ ok: false, reason: 'conflict' })
  })

  it('is a noop when base and head states are identical', () => {
    expect(buildRevertOperation(plan('same\n', 'same\n'), 'same\n')).toEqual({ ok: true, operation: 'noop' })
    expect(buildRevertOperation(plan(null, null), null)).toEqual({ ok: true, operation: 'noop' })
  })

  it('preserves whitespace exactly rather than normalizing it', () => {
    const target = '\n\n  indented\n\n\n'
    const result = buildRevertOperation(plan('changed\n', target), 'changed\n')
    expect(result).toEqual({ ok: true, operation: 'write', content: target })
  })
})

describe('getSnapshotChangeKind', () => {
  it('maps a deletion to delete rather than replace', () => {
    expect(getSnapshotChangeKind('deleted')).toBe('delete')
  })

  it('maps an addition to create', () => {
    expect(getSnapshotChangeKind('added')).toBe('create')
  })

  it('maps modifications and renames to modify', () => {
    expect(getSnapshotChangeKind('modified')).toBe('modify')
    expect(getSnapshotChangeKind('renamed')).toBe('modify')
  })
})

describe('buildSnapshotRevertPlan', () => {
  it('expects the head state and targets the base state', () => {
    const result = buildSnapshotRevertPlan({
      filePath: FILE,
      baseContent: 'before\n',
      headContent: 'after\n',
    })
    expect(result).toEqual({ filePath: FILE, expected: 'after\n', target: 'before\n' })
  })

  it('carries absence through for created files', () => {
    const result = buildSnapshotRevertPlan({
      filePath: FILE,
      baseContent: null,
      headContent: 'created\n',
    })
    expect(buildRevertOperation(result, 'created\n')).toEqual({ ok: true, operation: 'delete' })
  })

  it('carries absence through for deleted files', () => {
    const result = buildSnapshotRevertPlan({
      filePath: FILE,
      baseContent: 'was here\n',
      headContent: null,
    })
    expect(buildRevertOperation(result, null)).toEqual({
      ok: true,
      operation: 'write',
      content: 'was here\n',
    })
  })
})

describe('excludeUserSavedSnapshotChanges', () => {
  const changes = [
    { path: 'manuscript/ch1.md', status: 'modified' as const },
    { path: 'manuscript/ch2.md', status: 'modified' as const },
    { path: 'notes/new.md', status: 'renamed' as const, previousPath: 'notes/old.md' },
  ]

  it('drops files the user saved during the turn so they are neither attributed nor reverted', () => {
    const saved = new Set(['/workspace/manuscript/ch1.md'])
    expect(excludeUserSavedSnapshotChanges(changes, '/workspace/', saved).map(change => change.path))
      .toEqual(['manuscript/ch2.md', 'notes/new.md'])
  })

  it('drops a rename when the user saved either side', () => {
    const saved = new Set(['/workspace/notes/old.md'])
    expect(excludeUserSavedSnapshotChanges(changes, '/workspace', saved).map(change => change.path))
      .toEqual(['manuscript/ch1.md', 'manuscript/ch2.md'])
  })

  it('matches Windows separators', () => {
    const saved = new Set(['C:\\book\\manuscript\\ch2.md'])
    expect(excludeUserSavedSnapshotChanges(changes, 'C:\\book', saved).map(change => change.path))
      .toEqual(['manuscript/ch1.md', 'notes/new.md'])
  })
})
