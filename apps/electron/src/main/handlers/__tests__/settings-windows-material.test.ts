// input: Temporary app config and registered GUI settings RPC handlers
// output: Default, persistence, and IPC validation regression coverage
// pos: Exercises native appearance preferences without modifying user data
import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('defaults off and persists only boolean preferences through local GUI RPC', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'storyflow-material-'))
  try {
    const result = Bun.spawnSync([process.execPath, '--eval', `
      import { strict as assert } from 'node:assert';
      import { writeFileSync, readFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { registerSettingsGuiHandlers } from ${JSON.stringify(join(import.meta.dir, '..', 'settings.ts'))};
      import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
      const handlers = new Map();
      registerSettingsGuiHandlers({ handle: (channel, fn) => handlers.set(channel, fn) }, {});
      const get = handlers.get(RPC_CHANNELS.theme.GET_WINDOWS_BACKGROUND_MATERIAL);
      const set = handlers.get(RPC_CHANNELS.theme.SET_WINDOWS_BACKGROUND_MATERIAL);
      assert.equal(await get(), false);
      const path = join(process.env.CRAFT_CONFIG_DIR, 'config.json');
      writeFileSync(path, JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, colorTheme: 'github' }));
      assert.equal(await get(), false);
      await set({}, true);
      assert.equal(await get(), true);
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).colorTheme, 'github');
      const before = readFileSync(path, 'utf8');
      await assert.rejects(() => set({}, 'true'), TypeError);
      assert.equal(readFileSync(path, 'utf8'), before);
      await set({}, false);
      assert.equal(await get(), false);
      writeFileSync(path, JSON.stringify({ workspaces: [], windowsBackgroundMaterialEnabled: 'true' }));
      assert.equal(await get(), false);
    `], {
      cwd: join(import.meta.dir, '../../../../../..'),
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe', stderr: 'pipe',
    })
    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
})
