import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { applyPendingFreeConversationStorage, getFreeConversationStorage, scheduleFreeConversationStorage } from './free-conversation-storage'
import { resolveProjectOwnedFilePath } from './paths'

const fixtures: string[] = []
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'free-storage-'))); fixtures.push(base)
  const config = join(base, 'config'), root = join(config, 'runtime/free')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'result.md'), '原始作品\n')
  const parent = join(base, 'chosen'); mkdirSync(parent)
  return { base, config, root, parent }
}

test('defers migration, preserves content and old absolute paths across two moves', async () => {
  const { base, config, root, parent } = fixture()
  const scheduled = scheduleFreeConversationStorage(parent, config)
  expect(realpathSync(root)).toBe(root)
  await applyPendingFreeConversationStorage(config)
  const first = getFreeConversationStorage(config)
  expect(first.path).toBe(scheduled.pendingPath!)
  expect(first.pendingPath).toBeUndefined()
  expect(readFileSync(join(first.backupPath!, 'result.md'), 'utf8')).toBe('原始作品\n')
  expect(resolveProjectOwnedFilePath(root, join(root, 'result.md'))).toBe(join(root, 'result.md'))
  const secondParent = join(base, 'second'); mkdirSync(secondParent)
  scheduleFreeConversationStorage(secondParent, config)
  await applyPendingFreeConversationStorage(config)
  writeFileSync(join(root, 'result.md'), '更新作品\n')
  expect(readFileSync(join(first.path, 'result.md'), 'utf8')).toBe('更新作品\n')
  expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('更新作品\n')
  renameSync(parent, join(base, 'old-disk-offline'))
  expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('更新作品\n')
  expect(getFreeConversationStorage(config).path).toBe(join(secondParent, 'storyflow-free-conversations'))
})

test('rejects overlapping and existing destinations; cancellation keeps original storage', async () => {
  const { config, root, parent } = fixture()
  expect(() => scheduleFreeConversationStorage(root, config)).toThrow()
  scheduleFreeConversationStorage(parent, config)
  scheduleFreeConversationStorage(null, config)
  await applyPendingFreeConversationStorage(config)
  expect(realpathSync(root)).toBe(root)
  mkdirSync(join(parent, 'storyflow-free-conversations'))
  expect(() => scheduleFreeConversationStorage(parent, config)).toThrow('already exists')
})

test('a destination created after scheduling is preserved and original storage stays usable', async () => {
  const { config, root, parent } = fixture()
  const target = scheduleFreeConversationStorage(parent, config).pendingPath!
  mkdirSync(target); writeFileSync(join(target, 'unrelated'), 'keep')
  await applyPendingFreeConversationStorage(config)
  expect(getFreeConversationStorage(config).error).toContain('already exists')
  expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('原始作品\n')
  expect(readFileSync(join(target, 'unrelated'), 'utf8')).toBe('keep')
})

test('recovers a process exit after old directory rename without losing session files', async () => {
  const { config, root, parent } = fixture()
  const target = scheduleFreeConversationStorage(parent, config).pendingPath!
  const backup = `${root}.backup-test`
  renameSync(root, backup)
  mkdirSync(target); writeFileSync(join(target, 'partial-copy'), 'incomplete')
  writeFileSync(join(config, 'free-conversation-storage.json'), JSON.stringify({ pendingPath: target, sourcePath: root, backupPath: backup }))
  await applyPendingFreeConversationStorage(config)
  expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('原始作品\n')
  expect(getFreeConversationStorage(config).error).toBeDefined()
})

for (const missingRoot of [false, true]) {
  test(`finishes a journaled move with ${missingRoot ? 'missing' : 'indirect'} logical entry`, async () => {
    const { base, config, root, parent } = fixture()
    scheduleFreeConversationStorage(parent, config)
    await applyPendingFreeConversationStorage(config)
    const source = getFreeConversationStorage(config).path
    const secondParent = join(base, 'second'); mkdirSync(secondParent)
    const target = scheduleFreeConversationStorage(secondParent, config).pendingPath!
    const backup = `${source}.backup-test`
    renameSync(source, backup)
    mkdirSync(target); writeFileSync(join(target, 'result.md'), '原始作品\n')
    symlinkSync(target, source, process.platform === 'win32' ? 'junction' : 'dir')
    if (missingRoot) unlinkSync(root)
    writeFileSync(join(config, 'free-conversation-storage.json'), JSON.stringify({ pendingPath: target, sourcePath: source, backupPath: backup }))
    await applyPendingFreeConversationStorage(config)
    expect(getFreeConversationStorage(config).pendingPath).toBeUndefined()
    expect(getFreeConversationStorage(config).backupPath).toBe(backup)
    renameSync(parent, join(base, 'old-disk-offline'))
    expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('原始作品\n')
    await applyPendingFreeConversationStorage(config)
    expect(getFreeConversationStorage(config).path).toBe(target)
  })
}

test('ordinary and repeated startups do not move existing data', async () => {
  const { config, root, parent } = fixture()
  await applyPendingFreeConversationStorage(config)
  expect(realpathSync(root)).toBe(root)
  expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('原始作品\n')
  scheduleFreeConversationStorage(parent, config)
  await applyPendingFreeConversationStorage(config)
  const record = readFileSync(join(config, 'free-conversation-storage.json'), 'utf8')
  writeFileSync(join(root, 'result.md'), '升级后的用户内容\n')
  await applyPendingFreeConversationStorage(config)
  expect(readFileSync(join(config, 'free-conversation-storage.json'), 'utf8')).toBe(record)
  expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('升级后的用户内容\n')
})

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a failed link switch keeps storage usable and retries without copying', async () => {
  const { base, config, root, parent } = fixture()
  scheduleFreeConversationStorage(parent, config)
  await applyPendingFreeConversationStorage(config)
  const source = getFreeConversationStorage(config).path
  const target = join(base, 'latest'); mkdirSync(target)
  writeFileSync(join(target, 'result.md'), 'latest content')
  const backup = `${source}.backup-test`
  renameSync(source, backup)
  symlinkSync(target, source, 'dir')
  writeFileSync(join(config, 'free-conversation-storage.json'), JSON.stringify({ pendingPath: target, sourcePath: source, backupPath: backup }))
  chmodSync(dirname(root), 0o555)
  try {
    await applyPendingFreeConversationStorage(config)
    expect(getFreeConversationStorage(config).error).toBeDefined()
    expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('latest content')
    writeFileSync(join(root, 'result.md'), 'user continued working')
  } finally { chmodSync(dirname(root), 0o755) }
  await applyPendingFreeConversationStorage(config)
  expect(getFreeConversationStorage(config).error).toBeUndefined()
  renameSync(parent, join(base, 'old-disk-offline'))
  expect(readFileSync(join(root, 'result.md'), 'utf8')).toBe('user continued working')
})
