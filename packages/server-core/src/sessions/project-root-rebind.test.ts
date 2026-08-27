// input: A pending Session snapshot whose registered Project directory has moved
// output: Regression coverage that relink persists to the new root without recreating the old one
// pos: Guards SessionManager's durable Project locator rebind sequence

import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadSession } from '@craft-agent/shared/sessions'
import { runIsolatedJson } from './isolated-test-runner'

const SESSION_MANAGER_MODULE_PATH = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href

describe('Project root lifecycle', () => {
it('rebases a pending Session write without recreating the moved-from Project root', () => {
  const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-rebind-'))
  const configDir = join(parent, 'host')
  const previousRoot = join(parent, 'moved-from')
  const currentRoot = join(parent, 'moved-to')
  mkdirSync(join(currentRoot, '.craft-agent'), { recursive: true })
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(currentRoot, '.craft-agent', 'config.json'), JSON.stringify({
    id: 'directory-metadata-id',
    name: 'Project',
    slug: 'project',
    createdAt: 1,
    updatedAt: 1,
  }))
  mkdirSync(join(currentRoot, '.craft-agent', 'sessions', 'session-1'), { recursive: true })
  writeFileSync(
    join(currentRoot, '.craft-agent', 'sessions', 'session-1', 'session.jsonl'),
    `${JSON.stringify({ id: 'session-1', createdAt: 1, lastUsedAt: 1, messageCount: 0 })}\n`,
  )
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'project-1',
      name: 'Project',
      slug: 'project',
      rootPath: previousRoot,
      createdAt: 1,
      directoryConfigId: 'directory-metadata-id',
    }],
    activeWorkspaceId: 'project-1',
    activeSessionId: null,
  }))

  try {
    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `import { existsSync } from 'node:fs'; import { join } from 'node:path'; import { SessionManager, createManagedSession } from '${SESSION_MANAGER_MODULE_PATH}'; const manager = new SessionManager(); const managed = createManagedSession({ id: 'session-1' }, { id: 'project-1', name: 'Project', slug: 'project', rootPath: ${JSON.stringify(previousRoot)}, createdAt: 1, directoryConfigId: 'directory-metadata-id' }); managed.messagesLoaded = true; managed.messages = [{ id: 'message-1', role: 'user', content: 'keep me', timestamp: 1 }]; manager['sessions'].set(managed.id, managed); manager['persistSession'](managed); await Bun.sleep(600); manager['setupConfigWatcher'] = () => { throw new Error('watcher unavailable'); }; const updated = await manager.rebindWorkspaceRoot('project-1', ${JSON.stringify(currentRoot)}); console.log('REBIND_RESULT=' + JSON.stringify({ oldExists: existsSync(${JSON.stringify(previousRoot)}), newExists: existsSync(join(${JSON.stringify(currentRoot)}, '.craft-agent', 'sessions', 'session-1', 'session.jsonl')), committedRoot: updated.rootPath, runtimeState: managed.runtimeState ?? null })); manager.cleanup();`,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
    const match = run.stdout.toString().match(/REBIND_RESULT=(\{.*\})/)
    if (!match) throw new Error(`Missing rebind result:\n${run.stdout.toString()}`)
    expect(JSON.parse(match[1])).toEqual({
      oldExists: false,
      newExists: true,
      committedRoot: realpathSync(currentRoot),
      runtimeState: null,
    })
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

it('hydrates a cold Session from the moved-to root before staging it', () => {
  const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-rebind-cold-'))
  const configDir = join(parent, 'host')
  const previousRoot = join(parent, 'moved-from')
  const currentRoot = join(parent, 'moved-to')
  const sessionDir = join(currentRoot, '.craft-agent', 'sessions', 'session-cold')
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(currentRoot, '.craft-agent', 'config.json'), JSON.stringify({
    id: 'directory-cold', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
  }))
  writeFileSync(join(sessionDir, 'session.jsonl'), [
    JSON.stringify({
      id: 'session-cold', workspaceRootPath: previousRoot, createdAt: 1, lastUsedAt: 1,
      lastMessageAt: 1, messageCount: 1,
    }),
    JSON.stringify({
      id: 'message-cold', type: 'user', content: 'DO NOT LOSE', timestamp: 1, isQueued: true,
    }),
    '',
  ].join('\n'))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'project-1', name: 'Project', slug: 'project', rootPath: previousRoot,
      createdAt: 1, directoryConfigId: 'directory-cold',
    }],
    activeWorkspaceId: 'project-1', activeSessionId: null,
  }))

  try {
    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `import { SessionManager, createManagedSession } from '${SESSION_MANAGER_MODULE_PATH}'; const manager = new SessionManager(); const managed = createManagedSession({ id: 'session-cold' }, { id: 'project-1', name: 'Project', slug: 'project', rootPath: ${JSON.stringify(previousRoot)}, createdAt: 1, directoryConfigId: 'directory-cold' }); manager['sessions'].set(managed.id, managed); const recoveryStates = []; manager['processNextQueuedMessage'] = () => { recoveryStates.push(managed.runtimeState ?? null); }; await manager.rebindWorkspaceRoot('project-1', ${JSON.stringify(currentRoot)}); await new Promise(resolve => setImmediate(resolve)); console.log('COLD_REBIND_RESULT=' + JSON.stringify({ recoveryStates, queueLength: managed.messageQueue.length })); manager.cleanup();`,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe', stderr: 'pipe',
    })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
    const match = run.stdout.toString().match(/COLD_REBIND_RESULT=(\{.*\})/)
    if (!match) throw new Error(`Missing cold rebind result:\n${run.stdout.toString()}`)
    expect(JSON.parse(match[1])).toEqual({ recoveryStates: [null], queueLength: 1 })
    expect(loadSession(currentRoot, 'session-cold')?.messages.map(message => message.content))
      .toEqual(['DO NOT LOSE'])
    expect(existsSync(previousRoot)).toBe(false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

it('keeps a cold in-memory Session untouched when target staging fails', () => {
  const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-rebind-rollback-'))
  const configDir = join(parent, 'host')
  const previousRoot = join(parent, 'moved-from')
  const currentRoot = join(parent, 'moved-to')
  const sessionDir = join(currentRoot, '.craft-agent', 'sessions', 'session-cold')
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(currentRoot, '.craft-agent', 'config.json'), JSON.stringify({
    id: 'directory-rollback', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
  }))
  writeFileSync(join(sessionDir, 'session.jsonl'), [
    JSON.stringify({
      id: 'session-cold', name: 'Target title', workspaceRootPath: previousRoot,
      createdAt: 1, lastUsedAt: 1, lastMessageAt: 1, messageCount: 1,
    }),
    JSON.stringify({ id: 'target-message', type: 'user', content: 'TARGET', timestamp: 1 }),
    '',
  ].join('\n'))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'project-1', name: 'Project', slug: 'project', rootPath: previousRoot,
      createdAt: 1, directoryConfigId: 'directory-rollback',
    }],
    activeWorkspaceId: 'project-1', activeSessionId: null,
  }))

  try {
    const result = runIsolatedJson(configDir, 'COLD_ROLLBACK_RESULT',
      `import { SessionManager, createManagedSession } from '${SESSION_MANAGER_MODULE_PATH}'; const manager = new SessionManager(); const workspace = manager.getWorkspaces()[0]; const managed = createManagedSession({ id: 'session-cold', name: 'Old title' }, workspace); manager['sessions'].set(managed.id, managed); manager.flushSession = async () => { throw new Error('target flush failed'); }; let error; try { await manager.rebindWorkspaceRoot('project-1', ${JSON.stringify(currentRoot)}); } catch (cause) { error = cause.message; } console.log('COLD_ROLLBACK_RESULT=' + JSON.stringify({ error, messagesLoaded: managed.messagesLoaded, messageIds: managed.messages.map(message => message.id), name: managed.name, workspaceRoot: managed.workspace.rootPath, hostRoot: manager.getWorkspaces()[0].rootPath, runtimeState: managed.runtimeState ?? null })); manager.cleanup();`)
    expect(result).toEqual({
      error: 'target flush failed',
      messagesLoaded: false,
      messageIds: [],
      name: 'Old title',
      workspaceRoot: previousRoot,
      hostRoot: previousRoot,
      runtimeState: null,
    })
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

it('indexes target Sessions immediately when relinking after restart', () => {
  const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-rebind-restart-'))
  const configDir = join(parent, 'host')
  const previousRoot = join(parent, 'moved-from')
  const currentRoot = join(parent, 'moved-to')
  const sessionDir = join(currentRoot, '.craft-agent', 'sessions', 'session-after-restart')
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(currentRoot, '.craft-agent', 'config.json'), JSON.stringify({
    id: 'directory-restart', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
  }))
  writeFileSync(join(sessionDir, 'session.jsonl'), `${JSON.stringify({
    id: 'session-after-restart', workspaceRootPath: previousRoot,
    createdAt: 1, lastUsedAt: 1, lastMessageAt: 1, messageCount: 0,
  })}\n`)
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'project-1', name: 'Project', slug: 'project', rootPath: previousRoot,
      createdAt: 1, directoryConfigId: 'directory-restart',
    }],
    activeWorkspaceId: 'project-1', activeSessionId: null,
  }))

  try {
    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}'; const manager = new SessionManager(); await manager.rebindWorkspaceRoot('project-1', ${JSON.stringify(currentRoot)}); console.log('RESTART_RESULT=' + JSON.stringify(manager.getSessions('project-1').map(session => session.id))); manager.cleanup();`,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe', stderr: 'pipe',
    })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
    const match = run.stdout.toString().match(/RESTART_RESULT=(\[.*\])/)
    if (!match) throw new Error(`Missing restart result:\n${run.stdout.toString()}`)
    expect(JSON.parse(match[1])).toEqual(['session-after-restart'])
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

it('rejects Session creation while the Project root is missing', () => {
  const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-create-missing-'))
  const configDir = join(parent, 'host')
  const missingRoot = join(parent, 'moved-from')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'project-1', name: 'Project', slug: 'project', rootPath: missingRoot, createdAt: 1,
    }],
    activeWorkspaceId: 'project-1', activeSessionId: null,
  }))

  try {
    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `import { existsSync } from 'node:fs'; import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}'; const manager = new SessionManager(); let error; try { await manager.createSession('project-1'); } catch (cause) { error = cause.message; } console.log('CREATE_RESULT=' + JSON.stringify({ error, oldExists: existsSync(${JSON.stringify(missingRoot)}) })); manager.cleanup();`,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
    const match = run.stdout.toString().match(/CREATE_RESULT=(\{.*\})/)
    if (!match) throw new Error(`Missing create result:\n${run.stdout.toString()}`)
    const result = JSON.parse(match[1])
    expect(result.error).toContain('relink Project')
    expect(result.oldExists).toBe(false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
})
