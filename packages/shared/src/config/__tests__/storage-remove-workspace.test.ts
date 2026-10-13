import { afterEach, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

const storageUrl = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href
const setupUrl = pathToFileURL(join(import.meta.dir, '../../../tests/setup/register-pi-model-resolver.ts')).href
const temporaryDirs: string[] = []
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-remove-workspace-'))
  temporaryDirs.push(configDir)
  const projectRoot = join(configDir, 'user-project')
  const dataDir = join(configDir, 'workspaces', 'ws-1')
  mkdirSync(projectRoot)
  mkdirSync(join(dataDir, 'sessions', 'session-1', 'plans'), { recursive: true })
  writeFileSync(join(projectRoot, 'chapter.md'), 'user content')
  writeFileSync(join(dataDir, 'sessions', 'session-1', 'plans', 'plan.md'), 'recoverable plan')
  writeFileSync(join(dataDir, 'attachment.bin'), Buffer.from([0, 255, 7]))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'ws-1', name: 'Project', rootPath: projectRoot, createdAt: 1 }],
    activeWorkspaceId: 'ws-1', activeSessionId: null,
  }))
  return { configDir, dataDir, projectRoot, retainedDir: join(configDir, 'removed-workspaces') }
}

function remove(configDir: string, fault = '') {
  const result = Bun.spawnSync([process.execPath, '--eval', `
    import '${setupUrl}';
    import { spyOn } from 'bun:test';
    import * as fs from 'fs';
    ${fault}
    const { removeWorkspace } = await import('${storageUrl}');
    if (await removeWorkspace('ws-1') !== true) throw new Error('removal failed');
  `], { env: { ...process.env, CRAFT_CONFIG_DIR: configDir }, stdout: 'pipe', stderr: 'pipe' })
  expect(result.exitCode).toBe(0)
  const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
  expect(config.workspaces).toEqual([])
  expect(config.activeWorkspaceId).toBeNull()
  return result.stderr.toString()
}

it('retains the complete app directory and leaves user project files untouched', () => {
  const { configDir, dataDir, projectRoot, retainedDir } = fixture()
  remove(configDir)
  expect(existsSync(dataDir)).toBe(false)
  const backups = readdirSync(retainedDir)
  expect(backups).toHaveLength(1)
  const backup = join(retainedDir, backups[0]!)
  expect(readFileSync(join(backup, 'sessions/session-1/plans/plan.md'), 'utf8')).toBe('recoverable plan')
  expect(readFileSync(join(backup, 'attachment.bin'))).toEqual(Buffer.from([0, 255, 7]))
  expect(readFileSync(join(projectRoot, 'chapter.md'), 'utf8')).toBe('user content')
})

it('keeps the newest five removals across projects and ignores unrelated entries', () => {
  const { configDir, retainedDir } = fixture()
  mkdirSync(retainedDir)
  const names = Array.from({ length: 6 }, (_, i) => `170000000000${i}-00000000-0000-4000-8000-000000000000-project-${i}`)
  for (const name of names) {
    mkdirSync(join(retainedDir, name))
    writeFileSync(join(retainedDir, name, 'data'), name)
  }
  mkdirSync(join(retainedDir, 'manual-backup'))
  remove(configDir)
  const remaining = readdirSync(retainedDir)
  expect(remaining).toHaveLength(6)
  expect(remaining).toContain('manual-backup')
  for (const name of names.slice(0, 2)) expect(remaining).not.toContain(name)
  for (const name of names.slice(2)) expect(readFileSync(join(retainedDir, name, 'data'), 'utf8')).toBe(name)
})

for (const code of ['EXDEV', 'EACCES']) {
  it(`keeps original data when rename fails with ${code}, without rolling back config`, () => {
    const { configDir, dataDir, retainedDir } = fixture()
    const stderr = remove(configDir, `
      const originalRename = fs.renameSync;
      spyOn(fs, 'renameSync').mockImplementation((source, target) => {
        if (source === ${JSON.stringify(dataDir)}) throw Object.assign(new Error('injected ${code}'), { code: '${code}' });
        return originalRename(source, target);
      });
    `)
    expect(readFileSync(join(dataDir, 'attachment.bin'))).toEqual(Buffer.from([0, 255, 7]))
    expect(readdirSync(retainedDir)).toEqual([])
    expect(stderr).toContain('Failed to preserve workspace data directory')
    expect(stderr).toContain(code)
  })
}

it('keeps original data when the retention directory cannot be created', () => {
  const { configDir, dataDir, retainedDir } = fixture()
  writeFileSync(retainedDir, 'occupied')
  expect(remove(configDir)).toContain('Failed to preserve workspace data directory')
  expect(readFileSync(join(dataDir, 'attachment.bin'))).toEqual(Buffer.from([0, 255, 7]))
})

it('logs pruning failure while preserving the newly removed data', () => {
  const { configDir, dataDir, retainedDir } = fixture()
  mkdirSync(retainedDir)
  for (let i = 0; i < 5; i++) {
    mkdirSync(join(retainedDir, `170000000000${i}-00000000-0000-4000-8000-000000000000-old`))
  }
  const stderr = remove(configDir, `
    spyOn(fs, 'rmSync').mockImplementation(() => { throw new Error('injected pruning failure'); });
  `)
  expect(existsSync(dataDir)).toBe(false)
  const names = readdirSync(retainedDir)
  expect(names).toHaveLength(6)
  const current = names.find(name => name.endsWith('-ws-1'))!
  expect(readFileSync(join(retainedDir, current, 'attachment.bin'))).toEqual(Buffer.from([0, 255, 7]))
  expect(stderr).toContain('Failed to prune removed workspace backups')
})

it('succeeds without creating backups when the app directory is absent', () => {
  const { configDir, dataDir, retainedDir } = fixture()
  rmSync(dataDir, { recursive: true })
  remove(configDir)
  expect(existsSync(retainedDir)).toBe(false)
})

it('leaves the app directory in place when it contains a Project root', () => {
  const { configDir, dataDir, retainedDir } = fixture()
  const nestedRoot = join(dataDir, 'project')
  mkdirSync(nestedRoot)
  writeFileSync(join(nestedRoot, 'chapter.md'), 'live project')
  const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
  config.workspaces[0].rootPath = nestedRoot
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config))
  remove(configDir)
  expect(readFileSync(join(nestedRoot, 'chapter.md'), 'utf8')).toBe('live project')
  expect(existsSync(retainedDir)).toBe(false)
})
