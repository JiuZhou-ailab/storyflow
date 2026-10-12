import { expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedJson } from './isolated-test-runner'

it('returns a retryable storage code and removes unpublished sessions after creation write failure', () => {
  const parent = mkdtempSync(join(tmpdir(), 'session-create-busy-'))
  const project = join(parent, 'project')
  const host = join(parent, 'host')
  mkdirSync(join(project, '.craft-agent'), { recursive: true })
  mkdirSync(host)
  writeFileSync(join(host, 'config-defaults.json'), JSON.stringify({ workspaceDefaults: { permissionMode: 'ask', cyclablePermissionModes: ['safe', 'ask'], localMcpServers: [] } }))
  writeFileSync(join(project, '.craft-agent/config.json'), JSON.stringify({ id: 'directory', name: 'Test', slug: 'test', createdAt: 1, updatedAt: 1 }))
  writeFileSync(join(host, 'config.json'), JSON.stringify({ workspaces: [{ id: 'project', name: 'Test', rootPath: project, directoryConfigId: 'directory', createdAt: 1 }], activeWorkspaceId: 'project', activeSessionId: null }))
  try {
    const result = runIsolatedJson(host, 'RESULT', `
      import { spyOn } from 'bun:test';
      import * as fs from 'node:fs/promises';
      import { SessionManager } from ${JSON.stringify(join(import.meta.dir, 'SessionManager.ts'))};
      const manager = new SessionManager();
      const rename = spyOn(fs, 'rename').mockImplementation(async () => { throw Object.assign(new Error('busy'), { code: 'EPERM', path: 'session.jsonl' }); });
      const error = await manager.createSession('project').then(() => null, error => ({ code: error.code, message: error.message }));
      rename.mockRestore();
      if (error?.code !== 'EPERM' && error?.code !== 'SESSION_STORAGE_BUSY') throw new Error(JSON.stringify(error));
      const entries = await fs.readdir(${JSON.stringify(join(project, '.craft-agent/sessions'))});
      const session = await manager.createSession('project');
      manager.cleanup();
      console.log('RESULT=' + JSON.stringify({ error, entries, retried: !!session.id }));
    `)
    expect(result).toEqual({ error: { code: 'SESSION_STORAGE_BUSY', message: expect.not.stringContaining('relink') }, entries: [], retried: true })
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
