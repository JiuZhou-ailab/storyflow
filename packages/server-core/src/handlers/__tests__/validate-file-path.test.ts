// input: User file paths plus Project-owned defaults and Host-owned directory grants
// output: Regression coverage for attachment path containment and sensitive-file blocking
// pos: Guards the shared handler file-access trust boundary

import { describe, it, expect } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, sep } from 'path'
import { pathToFileURL } from 'url'
import { validateFilePath } from '../utils'

const home = homedir()
const tmp = tmpdir()
const UTILS_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'utils.ts')).href

describe('getWorkspaceAllowedDirs', () => {
  it('uses Host grants instead of a Project-owned default cwd', () => {
    const parent = mkdtempSync(join(tmp, 'craft-workspace-allowed-dirs-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const grantedCwd = join(parent, 'granted')
    const projectOwnedCwd = join(parent, 'project-owned')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir)
    mkdirSync(grantedCwd)
    mkdirSync(projectOwnedCwd)
    const canonicalProjectRoot = realpathSync(projectRoot)
    const canonicalGrantedCwd = realpathSync(grantedCwd)
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
      defaults: { workingDirectory: projectOwnedCwd },
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-id', name: 'Project', slug: 'project', rootPath: canonicalProjectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
        grantedWorkingDirectoryRoots: [canonicalGrantedCwd],
      }],
      activeWorkspaceId: 'project-id', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `import { getWorkspaceAllowedDirs } from '${UTILS_MODULE_PATH}'; console.log(JSON.stringify(getWorkspaceAllowedDirs('project-id')));`,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      expect(JSON.parse(run.stdout.toString())).toEqual([canonicalProjectRoot, canonicalGrantedCwd])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('validateFilePath', () => {
  it('allows paths inside home directory', async () => {
    const path = join(home, 'Documents', 'test.txt')
    const result = await validateFilePath(path)
    expect(result).toContain('test.txt')
  })

  it('allows paths inside temp directory', async () => {
    const path = join(tmp, 'craft-test.txt')
    const result = await validateFilePath(path)
    expect(result).toContain('craft-test.txt')
  })

  it('canonicalizes both an existing temp path and its allowed root', async () => {
    const dir = mkdtempSync(join(tmp, 'craft-realpath-test-'))
    const path = join(dir, 'test.txt')
    writeFileSync(path, 'ok')
    try {
      expect(await validateFilePath(path)).toContain('test.txt')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('rejects a missing file reached through a symlink escape', async () => {
    const dir = mkdtempSync(join(tmp, 'craft-symlink-test-'))
    const link = join(dir, 'outside')
    symlinkSync('/', link)
    try {
      await expect(validateFilePath(join(link, 'definitely-missing-file'))).rejects.toThrow('Access denied')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('denies paths outside all allowed directories', async () => {
    // Use a path that's definitely outside home and tmp on any platform
    const path = sep === '\\' ? 'Z:\\forbidden\\test.txt' : '/forbidden/test.txt'
    await expect(validateFilePath(path)).rejects.toThrow('Access denied')
  })

  it('allows paths inside additionalAllowedDirs', async () => {
    const projectDir = sep === '\\' ? 'D:\\Projects\\myapp' : '/opt/projects/myapp'
    const path = join(projectDir, 'src', 'main.ts')
    const result = await validateFilePath(path, [projectDir])
    expect(result).toContain('main.ts')
  })

  it('still allows homedir paths when additionalAllowedDirs are provided', async () => {
    const path = join(home, 'test.txt')
    const result = await validateFilePath(path, ['/some/other/dir'])
    expect(result).toContain('test.txt')
  })

  it('blocks sensitive files even inside allowed dirs', async () => {
    const path = join(home, '.ssh', 'id_rsa')
    await expect(validateFilePath(path)).rejects.toThrow('sensitive')
  })

  it('sensitive patterns match Windows backslash separators', () => {
    // Verify the regex patterns used in validateFilePath match both / and \
    const sshPatternUnix = /\.ssh[\\/]/
    const sshPatternWindows = /\.ssh[\\/]/
    expect(sshPatternUnix.test('C:\\Users\\me\\.ssh\\id_rsa')).toBe(true)
    expect(sshPatternWindows.test('/home/me/.ssh/id_rsa')).toBe(true)
    expect(/\.gnupg[\\/]/.test('C:\\Users\\me\\.gnupg\\keys')).toBe(true)
    expect(/\.aws[\\/]credentials/.test('C:\\Users\\me\\.aws\\credentials')).toBe(true)
  })

  it('blocks .env files', async () => {
    const path = join(home, 'project', '.env')
    await expect(validateFilePath(path)).rejects.toThrow('sensitive')
  })

  it('blocks credentials.json', async () => {
    const path = join(home, 'project', 'credentials.json')
    await expect(validateFilePath(path)).rejects.toThrow('sensitive')
  })

  it('blocks .pem files even inside additionalAllowedDirs', async () => {
    const projectDir = join(home, 'project')
    const path = join(projectDir, 'server.pem')
    await expect(validateFilePath(path, [projectDir])).rejects.toThrow('sensitive')
  })

  it('expands tilde paths', async () => {
    const result = await validateFilePath('~/test-file.txt')
    expect(result).toContain(home)
  })

  it('rejects relative paths', async () => {
    await expect(validateFilePath('relative/path.txt')).rejects.toThrow('absolute')
  })

  it('filters out falsy values in additionalAllowedDirs', async () => {
    const path = join(home, 'test.txt')
    // Should not throw even with undefined/empty values in the array
    const result = await validateFilePath(path, ['', undefined as unknown as string])
    expect(result).toContain('test.txt')
  })
})
