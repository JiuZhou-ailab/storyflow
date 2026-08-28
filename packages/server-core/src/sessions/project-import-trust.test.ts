// input: A portable Session bundle containing Project-owned executable capabilities
// output: Host-normalized permission and Source state before the bundle becomes runnable
// pos: Regression coverage for the Session import trust boundary

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SESSION_MANAGER_MODULE_PATH = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href

describe('Project Session import trust', () => {
  it('removes bundle capabilities that the target Host did not grant', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-import-trust-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const sourceDir = join(projectRoot, '.craft-agent', 'sources', 'project-source')
    mkdirSync(sourceDir, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
      id: 'project-source', slug: 'project-source', name: 'Project Source',
      type: 'api', enabled: true, api: { baseUrl: 'https://example.com', authType: 'none' },
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { readFileSync } from 'node:fs';
          import { join } from 'node:path';
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const result = await manager.importSession('project-1', {
            version: 1,
            session: {
              header: {
                id: 'bundle-session', createdAt: 1, permissionMode: 'allow-all',
                enabledSourceSlugs: ['project-source'],
              },
              messages: [],
            },
            files: [],
          }, 'move');
          const header = JSON.parse(readFileSync(join(${JSON.stringify(projectRoot)}, '.craft-agent', 'sessions', result.sessionId, 'session.jsonl'), 'utf8').split('\\n')[0]);
          console.log('IMPORT_RESULT=' + JSON.stringify({
            permissionMode: header.permissionMode,
            enabledSourceSlugs: header.enabledSourceSlugs,
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/IMPORT_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing import result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toEqual({ permissionMode: 'ask', enabledSourceSlugs: [] })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('does not overwrite an unindexed Session already present on disk', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-import-collision-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    const sessionDir = join(projectRoot, '.craft-agent', 'sessions', 'existing-session')
    const sessionFile = join(sessionDir, 'session.jsonl')
    mkdirSync(sessionDir, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-id', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    const original = [
      JSON.stringify({ id: 'existing-session', createdAt: 1, lastUsedAt: 1, messageCount: 1 }),
      JSON.stringify({ id: 'keep-message', type: 'user', content: 'keep original', timestamp: 1 }),
      '',
    ].join('\n')
    writeFileSync(sessionFile, original)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'directory-id',
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { readFileSync } from 'node:fs';
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          let error;
          try {
            await manager.importSession('project-1', {
              version: 1,
              session: { header: { id: 'existing-session', createdAt: 1 }, messages: [] },
              files: [],
            }, 'move');
          } catch (cause) { error = cause.message; }
          console.log('COLLISION_RESULT=' + JSON.stringify({ error, content: readFileSync(${JSON.stringify(sessionFile)}, 'utf8') }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/COLLISION_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing collision result:\n${run.stdout.toString()}`)
      const result = JSON.parse(match[1])
      expect(result.error).toContain('already exists')
      expect(result.content).toBe(original)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('remaps a moved Session ID already owned by another unindexed Project', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-import-host-collision-'))
    const configDir = join(parent, 'host')
    const sourceRoot = join(parent, 'source-project')
    const targetRoot = join(parent, 'target-project')
    const sourceSessionFile = join(
      sourceRoot,
      '.craft-agent',
      'sessions',
      'shared-session',
      'session.jsonl',
    )
    mkdirSync(join(sourceRoot, '.craft-agent', 'sessions', 'shared-session'), { recursive: true })
    mkdirSync(join(targetRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(sourceRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'source-directory', name: 'Source', slug: 'source', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(targetRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'target-directory', name: 'Target', slug: 'target', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(sourceSessionFile, `${JSON.stringify({
      id: 'shared-session', createdAt: 1, lastUsedAt: 1, messageCount: 0,
    })}\n`)
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [
        {
          id: 'source-project', name: 'Source', slug: 'source', rootPath: sourceRoot,
          createdAt: 1, directoryConfigId: 'source-directory',
        },
        {
          id: 'target-project', name: 'Target', slug: 'target', rootPath: targetRoot,
          createdAt: 1, directoryConfigId: 'target-directory',
        },
      ],
      activeWorkspaceId: 'target-project', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { existsSync } from 'node:fs';
          import { join } from 'node:path';
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const result = await manager.importSession('target-project', {
            version: 1,
            session: { header: { id: 'shared-session', createdAt: 1 }, messages: [] },
            files: [],
          }, 'move');
          console.log('HOST_COLLISION_RESULT=' + JSON.stringify({
            sessionId: result.sessionId,
            warning: result.warnings?.[0],
            sourceExists: existsSync(${JSON.stringify(sourceSessionFile)}),
            targetExists: existsSync(join(${JSON.stringify(targetRoot)}, '.craft-agent', 'sessions', result.sessionId, 'session.jsonl')),
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/HOST_COLLISION_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing Host collision result:\n${run.stdout.toString()}`)
      const result = JSON.parse(match[1])
      expect(result.sessionId).not.toBe('shared-session')
      expect(result.warning).toBe('Session ID was remapped because the source ID could not be proven unique on this Host.')
      expect(result.sourceExists).toBeTrue()
      expect(result.targetExists).toBeTrue()
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('treats a moved Session cwd as a target-Host capability before creating files', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-import-cwd-capability-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'target-project')
    const sourceRoot = join(parent, 'source-project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(sourceRoot)
    mkdirSync(configDir)
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'target-directory', name: 'Target', slug: 'target', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'target-project', name: 'Target', slug: 'target', rootPath: projectRoot,
        createdAt: 1, directoryConfigId: 'target-directory', grantedWorkingDirectoryRoots: [],
      }],
      activeWorkspaceId: 'target-project', activeSessionId: null,
    }))

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { existsSync, readFileSync } from 'node:fs';
          import { join } from 'node:path';
          import { SessionManager } from '${SESSION_MANAGER_MODULE_PATH}';
          const manager = new SessionManager();
          const result = await manager.importSession('target-project', {
            version: 1,
            session: {
              header: {
                id: 'moved-session', workspaceRootPath: ${JSON.stringify(sourceRoot)},
                workingDirectory: ${JSON.stringify(sourceRoot)}, createdAt: 1,
              },
              messages: [],
            },
            files: [],
          }, 'move');
          const sessionFile = join(${JSON.stringify(projectRoot)}, '.craft-agent', 'sessions', result.sessionId, 'session.jsonl');
          const header = JSON.parse(readFileSync(sessionFile, 'utf8').split('\\n')[0]);
          console.log('IMPORT_CWD_RESULT=' + JSON.stringify({
            workingDirectory: header.workingDirectory,
            warning: result.warnings?.[0],
            sessionExists: existsSync(sessionFile),
          }));
          manager.cleanup();
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/IMPORT_CWD_RESULT=(\{.*\})/)
      if (!match) throw new Error(`Missing import cwd result:\n${run.stdout.toString()}`)
      expect(JSON.parse(match[1])).toEqual({
        workingDirectory: realpathSync(projectRoot),
        warning: 'Working directory is not granted by the target Host; using the target Project root.',
        sessionExists: true,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
