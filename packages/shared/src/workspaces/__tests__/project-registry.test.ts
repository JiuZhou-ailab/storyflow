// input: Isolated Host registries, local Project roots, copied metadata, and Session path fixtures
// output: Regression coverage for Host-only registration, stable identity, conflict rejection, and locator rebasing
// pos: Guards the Product Host boundary between canonical Project IDs and mutable filesystem roots

import { describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listSessions, loadSession } from '../../sessions/storage.ts'
import { rebasePathWithinProjectRoot } from '../paths.ts'

const REGISTRY_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'project-registry.ts')).href
const CONFIG_STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'config', 'storage.ts')).href

function writeProjectConfig(
  rootPath: string,
  input: { id: string; name: string; workingDirectory?: string },
): void {
  mkdirSync(join(rootPath, '.craft-agent'), { recursive: true })
  writeFileSync(join(rootPath, '.craft-agent', 'config.json'), JSON.stringify({
    id: input.id,
    name: input.name,
    slug: input.name.toLowerCase().replace(/\s+/g, '-'),
    defaults: input.workingDirectory ? { workingDirectory: input.workingDirectory } : {},
    createdAt: 1,
    updatedAt: 1,
  }, null, 2))
}

function writeHostConfig(
  configDir: string,
  workspaces: Array<{ id: string; name: string; rootPath: string; directoryConfigId?: string }>,
  activeWorkspaceId = workspaces[0]?.id ?? null,
): void {
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'config-defaults.json'), JSON.stringify({
    workspaceDefaults: {
      permissionMode: 'ask',
      cyclablePermissionModes: ['safe', 'ask'],
      localMcpServers: [],
    },
  }))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: workspaces.map(workspace => ({
      ...workspace,
      slug: workspace.name.toLowerCase().replace(/\s+/g, '-'),
      createdAt: 1,
    })),
    activeWorkspaceId,
    activeSessionId: null,
  }, null, 2))
}

function runRegistry(
  configDir: string,
  expression: string,
): { result?: unknown; error?: string } {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import * as registry from '${REGISTRY_MODULE_PATH}'; try { console.log(JSON.stringify({ result: ${expression} })) } catch (error) { console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`registry subprocess failed\n${run.stderr.toString()}`)
  }
  return JSON.parse(run.stdout.toString())
}

function writeSessionHeader(rootPath: string, sessionId: string, header: Record<string, unknown>): void {
  const sessionDir = join(rootPath, '.craft-agent', 'sessions', sessionId)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'session.jsonl'), `${JSON.stringify({
    id: sessionId,
    createdAt: 1,
    lastUsedAt: 1,
    messageCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
    ...header,
  })}\n`)
}

describe('Project registry identity and locator', () => {
  it('keeps low-level Host registration free of filesystem initialization', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-host-project-register-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'not-initialized')
    writeHostConfig(configDir, [])

    try {
      const response = runRegistry(
        configDir,
        `(await import('${CONFIG_STORAGE_MODULE_PATH}')).addWorkspace({ name: 'Host Only', rootPath: ${JSON.stringify(projectRoot)} })`,
      )
      expect(response.error).toBeUndefined()
      expect(existsSync(projectRoot)).toBe(false)
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces[0])
        .toMatchObject({ name: 'Host Only', rootPath: projectRoot })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('registers an existing directory without replacing ordinary files', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-register-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(projectRoot)
    writeFileSync(join(projectRoot, 'keep.md'), 'keep me')
    writeHostConfig(configDir, [])

    try {
      const response = runRegistry(
        configDir,
        `registry.registerLocalProject('Project', ${JSON.stringify(projectRoot)})`,
      )
      expect(response.error).toBeUndefined()
      expect(readFileSync(join(projectRoot, 'keep.md'), 'utf8')).toBe('keep me')
      expect(readFileSync(join(projectRoot, '.craft-agent', 'config.json'), 'utf8')).toContain('Project')
      const host = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
      const directory = JSON.parse(readFileSync(join(projectRoot, '.craft-agent', 'config.json'), 'utf8'))
      expect(host.workspaces[0].directoryConfigId).toBe(directory.id)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('does not claim root files that merely resemble legacy Host state', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-ordinary-config-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, 'sources', 'ordinary-source'), { recursive: true })
    mkdirSync(join(projectRoot, 'sessions', 'ordinary-session'), { recursive: true })
    writeFileSync(join(projectRoot, 'config.json'), JSON.stringify({
      id: 'ordinary-app', name: 'Ordinary App', slug: 'ordinary-app', createdAt: 1,
    }))
    writeFileSync(join(projectRoot, 'README.md'), '# Keep ordinary files\n')
    writeFileSync(join(projectRoot, 'sources', 'ordinary-source', 'keep.txt'), 'source data')
    writeFileSync(join(projectRoot, 'sessions', 'ordinary-session', 'keep.txt'), 'session data')
    writeHostConfig(configDir, [])

    try {
      const response = runRegistry(
        configDir,
        `(registry.registerLocalProject('Storyflow Project', ${JSON.stringify(projectRoot)}), (await import('${CONFIG_STORAGE_MODULE_PATH}')).getWorkspaces())`,
      )
      expect(response.error).toBeUndefined()
      expect(readFileSync(join(projectRoot, 'config.json'), 'utf8')).toContain('ordinary-app')
      expect(readFileSync(join(projectRoot, 'README.md'), 'utf8')).toBe('# Keep ordinary files\n')
      expect(readFileSync(join(projectRoot, 'sources', 'ordinary-source', 'keep.txt'), 'utf8')).toBe('source data')
      expect(readFileSync(join(projectRoot, 'sessions', 'ordinary-session', 'keep.txt'), 'utf8')).toBe('session data')
      expect(JSON.parse(readFileSync(join(projectRoot, '.craft-agent', 'config.json'), 'utf8')).id)
        .not.toBe('ordinary-app')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rebases only paths owned by the previous Project root', () => {
    expect(rebasePathWithinProjectRoot('/old/project/chapters/1.md', '/old/project', '/new/project'))
      .toBe('/new/project/chapters/1.md')
    expect(rebasePathWithinProjectRoot('/external/reference', '/old/project', '/new/project'))
      .toBe('/external/reference')
  })

  it('rebases legacy Session locators lazily when loading them from the moved root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-session-rebase-'))
    const previousRoot = join(parent, 'previous')
    const currentRoot = join(parent, 'current')
    const externalCwd = join(parent, 'external')

    try {
      writeSessionHeader(currentRoot, 'session-1', {
        workspaceRootPath: previousRoot,
        workingDirectory: join(previousRoot, 'drafts'),
        sdkCwd: externalCwd,
        branchFromSessionPath: join(previousRoot, '.craft-agent', 'sessions', 'parent'),
        branchFromSdkCwd: join(previousRoot, 'drafts'),
      })

      const loaded = loadSession(currentRoot, 'session-1')
      expect(loaded?.workspaceRootPath).toBe(currentRoot)
      expect(loaded?.workingDirectory).toBe(join(currentRoot, 'drafts'))
      expect(loaded?.sdkCwd).toBe(externalCwd)
      expect(loaded?.branchFromSessionPath).toBe(join(currentRoot, '.craft-agent', 'sessions', 'parent'))
      expect(loaded?.branchFromSdkCwd).toBe(join(currentRoot, 'drafts'))

      const [metadata] = listSessions(currentRoot)
      expect(metadata?.workspaceRootPath).toBe(currentRoot)
      expect(metadata?.workingDirectory).toBe(join(currentRoot, 'drafts'))
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('keeps the Host Project ID while relinking its root and default cwd', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-relink-'))
    const configDir = join(parent, 'host')
    const previousRoot = join(parent, 'moved-from')
    const currentRoot = join(parent, 'moved-to')
    writeProjectConfig(currentRoot, {
      id: 'directory-metadata-id',
      name: 'Moved Project',
      workingDirectory: join(previousRoot, 'drafts'),
    })
    writeHostConfig(configDir, [{
      id: 'project-stable',
      name: 'Moved Project',
      rootPath: previousRoot,
      directoryConfigId: 'directory-metadata-id',
    }])

    try {
      const response = runRegistry(
        configDir,
        `registry.relinkWorkspaceRoot('project-stable', ${JSON.stringify(currentRoot)})`,
      )
      expect(response.error).toBeUndefined()

      const hostConfig = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
      const directoryConfig = JSON.parse(readFileSync(join(currentRoot, '.craft-agent', 'config.json'), 'utf8'))
      const canonicalRoot = realpathSync(currentRoot)
      expect(hostConfig.activeWorkspaceId).toBe('project-stable')
      expect(hostConfig.workspaces[0]).toMatchObject({ id: 'project-stable', rootPath: canonicalRoot })
      expect(directoryConfig.id).toBe('directory-metadata-id')
      expect(directoryConfig.defaults.workingDirectory).toBe(join(canonicalRoot, 'drafts'))
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects a relink target already registered through another path alias', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-root-conflict-'))
    const configDir = join(parent, 'host')
    const registeredRoot = join(parent, 'registered')
    const aliasRoot = join(parent, 'alias')
    writeProjectConfig(registeredRoot, { id: 'directory-registered', name: 'Registered' })
    symlinkSync(registeredRoot, aliasRoot, 'dir')
    writeHostConfig(configDir, [
      { id: 'project-missing', name: 'Missing', rootPath: join(parent, 'missing'), directoryConfigId: 'directory-registered' },
      { id: 'project-registered', name: 'Registered', rootPath: registeredRoot, directoryConfigId: 'directory-registered' },
    ], 'project-missing')

    try {
      const response = runRegistry(
        configDir,
        `registry.relinkWorkspaceRoot('project-missing', ${JSON.stringify(aliasRoot)})`,
      )
      expect(response.error).toContain('already belongs')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects copied Project state instead of assigning colliding Sessions a second Host identity', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-copy-conflict-'))
    const configDir = join(parent, 'host')
    const registeredRoot = join(parent, 'registered')
    const copiedRoot = join(parent, 'copied')
    writeProjectConfig(registeredRoot, { id: 'copied-directory-id', name: 'Registered' })
    writeProjectConfig(copiedRoot, { id: 'copied-directory-id', name: 'Copied' })
    writeSessionHeader(registeredRoot, 'same-session', { workspaceRootPath: registeredRoot })
    writeSessionHeader(copiedRoot, 'same-session', { workspaceRootPath: copiedRoot })
    writeHostConfig(configDir, [
      { id: 'project-registered', name: 'Registered', rootPath: registeredRoot },
    ])

    try {
      const response = runRegistry(
        configDir,
        `registry.registerLocalProject('Copied', ${JSON.stringify(copiedRoot)})`,
      )
      expect(response.error).toContain('already registered')
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces).toHaveLength(1)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('requires relink when moved Project content is selected through Add Project', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-readd-moved-'))
    const configDir = join(parent, 'host')
    const movedRoot = join(parent, 'moved')
    writeProjectConfig(movedRoot, { id: 'directory-moved', name: 'Moved' })
    writeHostConfig(configDir, [{
      id: 'project-stable', name: 'Moved', rootPath: join(parent, 'missing'),
      directoryConfigId: 'directory-moved',
    }])

    try {
      const response = runRegistry(
        configDir,
        `registry.registerLocalProject('Moved', ${JSON.stringify(movedRoot)})`,
      )
      expect(response.error).toContain('Relink')
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces).toHaveLength(1)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('marks a replaced locator unavailable without adopting the replacement identity', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-replaced-root-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    writeProjectConfig(projectRoot, { id: 'directory-replacement', name: 'Replacement' })
    writeHostConfig(configDir, [{
      id: 'project-stable', name: 'Original', rootPath: projectRoot,
      directoryConfigId: 'directory-original',
    }])

    try {
      const response = runRegistry(
        configDir,
        `({ workspace: (await import('${CONFIG_STORAGE_MODULE_PATH}')).getWorkspaces()[0], available: registry.isWorkspaceRootAvailable((await import('${CONFIG_STORAGE_MODULE_PATH}')).getWorkspaces()[0]), runtimeLookup: (await import('${CONFIG_STORAGE_MODULE_PATH}')).getWorkspaceByNameOrId('project-stable') })`,
      )
      expect(response.error).toBeUndefined()
      expect(response.result).toMatchObject({
        available: false,
        runtimeLookup: null,
        workspace: { name: 'Original', rootAvailable: false },
      })
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces[0].name)
        .toBe('Original')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects Add Project when the same path now contains a different Project', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-readd-replaced-root-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    writeProjectConfig(projectRoot, { id: 'directory-replacement', name: 'Replacement' })
    writeHostConfig(configDir, [{
      id: 'project-stable', name: 'Original', rootPath: projectRoot,
      directoryConfigId: 'directory-original',
    }])

    try {
      const response = runRegistry(
        configDir,
        `registry.registerLocalProject('Replacement', ${JSON.stringify(projectRoot)})`,
      )
      expect(response.error).toContain('no longer matches')
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces[0])
        .toMatchObject({ id: 'project-stable', directoryConfigId: 'directory-original' })
      expect(JSON.parse(readFileSync(join(projectRoot, '.craft-agent', 'config.json'), 'utf8')).id)
        .toBe('directory-replacement')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects remote conversion when the local Project identity is unavailable', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-remote-replaced-root-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    writeProjectConfig(projectRoot, { id: 'directory-replacement', name: 'Replacement' })
    writeHostConfig(configDir, [{
      id: 'project-stable', name: 'Original', rootPath: projectRoot,
      directoryConfigId: 'directory-original',
    }])

    try {
      const response = runRegistry(
        configDir,
        `await (await import('${CONFIG_STORAGE_MODULE_PATH}')).updateWorkspaceRemoteServer('project-stable', { url: 'wss://remote.example.test', token: 'secret', remoteWorkspaceId: 'remote-project' })`,
      )
      expect(response.error).toContain('Relink this Project')
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces[0].remoteServer)
        .toBeUndefined()
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('binds a legacy Host registration only after the user selects that same directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-bind-legacy-root-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    writeProjectConfig(projectRoot, { id: 'directory-legacy', name: 'Legacy' })
    writeHostConfig(configDir, [{
      id: 'project-stable', name: 'Legacy', rootPath: projectRoot,
    }])

    try {
      const before = runRegistry(
        configDir,
        `(await import('${CONFIG_STORAGE_MODULE_PATH}')).getWorkspaces()[0]`,
      )
      expect(before.result).toMatchObject({ id: 'project-stable', rootAvailable: false })

      const response = runRegistry(
        configDir,
        `registry.registerLocalProject('Legacy', ${JSON.stringify(projectRoot)})`,
      )
      expect(response.error).toBeUndefined()
      expect(response.result).toMatchObject({
        id: 'project-stable',
        directoryConfigId: 'directory-legacy',
        rootAvailable: true,
      })
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces[0])
        .toMatchObject({ id: 'project-stable', directoryConfigId: 'directory-legacy' })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('lets the unavailable-project relink flow verify a legacy same-path registration', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-relink-legacy-root-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    writeProjectConfig(projectRoot, { id: 'directory-legacy', name: 'Legacy' })
    writeHostConfig(configDir, [{
      id: 'project-stable', name: 'Legacy', rootPath: projectRoot,
    }])

    try {
      const response = runRegistry(
        configDir,
        `registry.relinkWorkspaceRoot('project-stable', ${JSON.stringify(projectRoot)})`,
      )
      expect(response.error).toBeUndefined()
      expect(response.result).toMatchObject({
        id: 'project-stable',
        directoryConfigId: 'directory-legacy',
        rootAvailable: true,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('does not migrate an unverified legacy locator while listing Projects', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-list-unverified-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, 'sessions', 'session-legacy'), { recursive: true })
    writeFileSync(join(projectRoot, 'config.json'), JSON.stringify({
      id: 'directory-replacement', name: 'Replacement', slug: 'replacement',
      createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(projectRoot, 'sessions', 'session-legacy', 'keep.txt'), 'keep')
    writeHostConfig(configDir, [{
      id: 'project-stable', name: 'Original', rootPath: projectRoot,
      directoryConfigId: 'directory-original',
    }])

    try {
      const response = runRegistry(
        configDir,
        `(await import('${CONFIG_STORAGE_MODULE_PATH}')).getWorkspaces()[0]`,
      )
      expect(response.result).toMatchObject({
        id: 'project-stable', name: 'Original', rootAvailable: false,
      })
      expect(existsSync(join(projectRoot, '.craft-agent'))).toBe(false)
      expect(readFileSync(join(projectRoot, 'sessions', 'session-legacy', 'keep.txt'), 'utf8'))
        .toBe('keep')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('does not migrate a rejected legacy relink target', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-relink-rejected-'))
    const configDir = join(parent, 'host')
    const targetRoot = join(parent, 'target')
    mkdirSync(targetRoot)
    writeFileSync(join(targetRoot, 'config.json'), JSON.stringify({
      id: 'legacy-project', name: 'Legacy', slug: 'legacy', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(targetRoot, 'craft-writing.json'), JSON.stringify({ schemaVersion: 1, type: 'novel' }))
    writeFileSync(join(targetRoot, 'README.md'), 'unchanged')
    writeHostConfig(configDir, [{
      id: 'project-stable',
      name: 'Legacy',
      rootPath: join(parent, 'missing'),
      directoryConfigId: 'legacy-project',
    }])

    try {
      const response = runRegistry(
        configDir,
        `registry.relinkWorkspaceRoot('project-stable', ${JSON.stringify(targetRoot)}, ['missing-session'])`,
      )
      expect(response.error).toContain('existing Storyflow Project')
      expect(readFileSync(join(targetRoot, 'README.md'), 'utf8')).toBe('unchanged')
      expect(existsSync(join(targetRoot, 'config.json'))).toBe(true)
      expect(existsSync(join(targetRoot, '.craft-agent'))).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects a Project state directory symlink without touching its target', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-state-symlink-'))
    const configDir = join(parent, 'host')
    const targetRoot = join(parent, 'target')
    const outsideState = join(parent, 'outside-state')
    mkdirSync(targetRoot)
    mkdirSync(outsideState)
    const outsideConfig = JSON.stringify({
      id: 'outside-project', name: 'Outside', slug: 'outside', createdAt: 1, updatedAt: 1,
    })
    writeFileSync(join(outsideState, 'config.json'), outsideConfig)
    symlinkSync(outsideState, join(targetRoot, '.craft-agent'), 'dir')
    writeHostConfig(configDir, [{ id: 'project-stable', name: 'Project', rootPath: join(parent, 'missing') }])

    try {
      const response = runRegistry(
        configDir,
        `registry.relinkWorkspaceRoot('project-stable', ${JSON.stringify(targetRoot)})`,
      )
      expect(response.error).toBeDefined()
      expect(readFileSync(join(outsideState, 'config.json'), 'utf8')).toBe(outsideConfig)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects an unrelated Project after restart even when no Sessions were indexed', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-relink-fingerprint-'))
    const configDir = join(parent, 'host')
    const unrelatedRoot = join(parent, 'unrelated')
    writeProjectConfig(unrelatedRoot, { id: 'directory-b', name: 'Other Project' })
    writeHostConfig(configDir, [{
      id: 'project-a',
      name: 'Moved Project',
      rootPath: join(parent, 'missing'),
      directoryConfigId: 'directory-a',
    }])

    try {
      const response = runRegistry(
        configDir,
        `registry.relinkWorkspaceRoot('project-a', ${JSON.stringify(unrelatedRoot)})`,
      )
      expect(response.error).toContain('different Storyflow Project')
      expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).workspaces[0].rootPath)
        .toBe(join(parent, 'missing'))
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
