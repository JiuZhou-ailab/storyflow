import { expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedJson } from './isolated-test-runner'

it('restores permission modes across Host restarts and applies the latest manual choice to new conversations', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'storyflow-permission-restart-')))
  const host = join(root, 'host')
  const project = join(root, 'project')
  mkdirSync(host)
  mkdirSync(join(project, '.craft-agent'), { recursive: true })
  writeFileSync(join(project, '.craft-agent/config.json'), JSON.stringify({
    id: 'directory', name: 'Test', slug: 'test', createdAt: 1, updatedAt: 1,
  }))
  writeFileSync(join(host, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'project', name: 'Test', rootPath: project, directoryConfigId: 'directory', createdAt: 1 }],
    activeWorkspaceId: 'project',
    activeSessionId: null,
  }))

  const runHost = <T>(scenario: string): T => runIsolatedJson(host, 'RESULT', `
    import { SessionManager } from ${JSON.stringify(join(import.meta.dir, 'SessionManager.ts'))};
    import { registerSessionsHandlers } from ${JSON.stringify(join(import.meta.dir, '../handlers/rpc/sessions.ts'))};
    import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
    import { getFreeConversationWorkspace } from '@craft-agent/shared/workspaces';
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    const sessionManager = new SessionManager();
    sessionManager.reinitializeAuth = async () => {};
    await sessionManager.initialize();
    const handlers = new Map();
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    registerSessionsHandlers({ handle: (channel, fn) => handlers.set(channel, fn) }, { platform: { logger }, sessionManager });
    const ctx = { clientId: 'client', workspaceId: 'project', webContentsId: null };
    const create = (options, workspaceId = 'project') => handlers.get(RPC_CHANNELS.sessions.CREATE)(ctx, workspaceId, options);
    const select = (id, mode, remember) => handlers.get(RPC_CHANNELS.sessions.COMMAND)(ctx, id, { type: 'setPermissionMode', mode, remember });
    const mode = id => sessionManager.getSessionPermissionModeState(id)?.permissionMode;
    const result = await (async () => { ${scenario} })();
    await sessionManager.shutdown();
    console.log('RESULT=' + JSON.stringify(result));
  `)

  try {
    const ids = runHost<Record<'selected' | 'inherited' | 'free' | 'oneOff', string>>(`
      const selected = await create();
      await select(selected.id, 'allow-all', true);
      const preferencesPath = join(process.env.CRAFT_CONFIG_DIR, 'session-permission-modes.json');
      const beforeGateway = readFileSync(preferencesPath, 'utf8');
      if (JSON.parse(beforeGateway).lastSelectedMode !== 'allow-all') throw new Error('Missing remembered execute mode');
      const gateway = await sessionManager.createSession('project', { name: 'Gateway /new' });
      if (gateway.permissionMode !== 'ask' || readFileSync(preferencesPath, 'utf8') !== beforeGateway) {
        throw new Error('Gateway /new inherited execute mode or wrote an execute grant');
      }
      const inherited = await create({ inheritPermissionMode: true });
      const free = await create({ inheritPermissionMode: true }, getFreeConversationWorkspace().id);
      const oneOff = await create({ permissionMode: 'allow-all' });
      return { selected: selected.id, inherited: inherited.id, free: free.id, oneOff: oneOff.id };
    `)

    const afterExecute = runHost<{
      restored: string[]; defaultModes: string[]; ask: string; next: string; temporary: string
    }>(`
      const ids = ${JSON.stringify(ids)};
      const restored = Object.values(ids).map(mode);
      const defaultModes = [];
      for (const options of [{ inheritPermissionMode: true }, { inheritPermissionMode: true, permissionMode: 'safe' }, { inheritPermissionMode: true, hidden: true }, undefined]) {
        defaultModes.push((await create(options)).permissionMode);
      }
      await select(ids.selected, 'safe', false);
      await select(ids.selected, 'allow-all');
      defaultModes.push((await create({ inheritPermissionMode: true })).permissionMode);
      await select(ids.oneOff, 'ask', true);
      const next = await create({ inheritPermissionMode: true });
      await select(next.id, 'allow-all', false);
      const ask = await create({ inheritPermissionMode: true });
      return { restored, defaultModes, ask: ask.id, next: next.permissionMode, temporary: next.id };
    `)
    expect(afterExecute.restored).toEqual(['allow-all', 'allow-all', 'allow-all', 'ask'])
    expect(afterExecute.defaultModes).toEqual(['allow-all', 'safe', 'ask', 'ask', 'allow-all'])
    expect(afterExecute.next).toBe('ask')

    expect(runHost<Record<string, string>>(`
      const ids = ${JSON.stringify(ids)};
      return {
        selected: mode(ids.selected),
        inherited: mode(ids.inherited),
        ask: mode(${JSON.stringify(afterExecute.ask)}),
        temporary: mode(${JSON.stringify(afterExecute.temporary)}),
        newConversation: (await create({ inheritPermissionMode: true })).permissionMode,
      };
    `)).toEqual({ selected: 'ask', inherited: 'allow-all', ask: 'ask', temporary: 'ask', newConversation: 'ask' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
