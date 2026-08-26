// input: One unsafe Project Session store and one healthy registered Project
// output: Per-Project initialization failure without cross-Project history loss
// pos: Regression coverage for sharded Session discovery health

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SESSION_MANAGER_MODULE_PATH = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href

function writeProjectConfig(rootPath: string, id: string): void {
  mkdirSync(join(rootPath, '.craft-agent'), { recursive: true })
  writeFileSync(join(rootPath, '.craft-agent', 'config.json'), JSON.stringify({
    id, name: id, slug: id, createdAt: 1, updatedAt: 1,
  }))
}

describe('Project Session initialization isolation', () => {
  it('keeps a healthy Project available when another Session store is unsafe', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-session-init-'))
    const configDir = join(parent, 'host')
    const badRoot = join(parent, 'bad')
    const goodRoot = join(parent, 'good')
    const outsideSessions = join(parent, 'outside-sessions')
    writeProjectConfig(badRoot, 'directory-bad')
    writeProjectConfig(goodRoot, 'directory-good')
    mkdirSync(outsideSessions)
    symlinkSync(outsideSessions, join(badRoot, '.craft-agent', 'sessions'), 'dir')
    const goodSessionDir = join(goodRoot, '.craft-agent', 'sessions', 'session-good')
    mkdirSync(goodSessionDir, { recursive: true })
    writeFileSync(join(goodSessionDir, 'session.jsonl'), `${JSON.stringify({
      id: 'session-good', createdAt: 1, lastUsedAt: 1, messageCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    })}\n`)
    mkdirSync(configDir)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [
        { id: 'project-bad', name: 'Bad', slug: 'bad', rootPath: badRoot, createdAt: 1, directoryConfigId: 'directory-bad' },
        { id: 'project-good', name: 'Good', slug: 'good', rootPath: goodRoot, createdAt: 1, directoryConfigId: 'directory-good' },
      ],
      activeWorkspaceId: 'project-bad', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          await manager.persistence.loadSessionsFromDisk();
          let badError;
          try { await manager.waitForInit('project-bad'); } catch (error) { badError = error.message; }
          await manager.waitForInit('project-good');
          console.log('INIT_RESULT=' + JSON.stringify({
            badError,
            goodIds: manager.getSessions('project-good').map(session => session.id),
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/INIT_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing init result:\n${run.stdout.toString()}`)
      const result = JSON.parse(match[1])
      expect(result.badError).toContain('symbolic link')
      expect(result.goodIds).toEqual(['session-good'])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('marks a Project with a symlinked state root unavailable without hiding healthy history', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-project-state-init-'))
    const configDir = join(parent, 'host')
    const badRoot = join(parent, 'bad')
    const goodRoot = join(parent, 'good')
    const outsideState = join(parent, 'outside-state')
    mkdirSync(badRoot)
    mkdirSync(outsideState)
    writeFileSync(join(outsideState, 'config.json'), JSON.stringify({
      id: 'directory-bad', name: 'Bad', slug: 'bad', createdAt: 1, updatedAt: 1,
    }))
    symlinkSync(outsideState, join(badRoot, '.craft-agent'), 'dir')
    writeProjectConfig(goodRoot, 'directory-good')
    const goodSessionDir = join(goodRoot, '.craft-agent', 'sessions', 'session-good')
    mkdirSync(goodSessionDir, { recursive: true })
    writeFileSync(join(goodSessionDir, 'session.jsonl'), `${JSON.stringify({
      id: 'session-good', createdAt: 1, lastUsedAt: 1, messageCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    })}\n`)
    mkdirSync(configDir)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [
        { id: 'project-bad', name: 'Bad', slug: 'bad', rootPath: badRoot, createdAt: 1, directoryConfigId: 'directory-bad' },
        { id: 'project-good', name: 'Good', slug: 'good', rootPath: goodRoot, createdAt: 1, directoryConfigId: 'directory-good' },
      ],
      activeWorkspaceId: 'project-bad', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          await manager.persistence.loadSessionsFromDisk();
          await manager.waitForInit('project-good');
          console.log('STATE_RESULT=' + JSON.stringify({
            badAvailable: manager.getWorkspaces().find(workspace => workspace.id === 'project-bad')?.rootAvailable,
            goodIds: manager.getSessions('project-good').map(session => session.id),
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/STATE_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing state result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toEqual({
        badAvailable: false,
        goodIds: ['session-good'],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
