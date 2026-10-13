// input: Real Electron lifecycle, installed electron-updater, and main-process quit wiring
// output: Native exit regression coverage without downloading or launching an installer
// pos: Verifies the quit event boundary used by automatic update installation

import { expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Linux CI runners lack a SUID chrome-sandbox; this test covers the quit lifecycle, not the OS sandbox.
const LINUX_CI_SANDBOX_ARGS = process.platform === 'linux' ? ['--no-sandbox'] : []

it.each([false, true])('installs on native app.exit after document approval (cleanup stalls: %s)', (stalls) => {
  const directory = mkdtempSync(join(tmpdir(), 'storyflow-native-quit-'))
  try {
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const coordinator = readFileSync(new URL('../quit-coordinator.ts', import.meta.url), 'utf8')
    const wiring = index.slice(index.indexOf('async function allowDocumentExit()'), index.indexOf("process.on('uncaughtException'"))
    const script = join(directory, 'quit.cjs')
    const receipt = join(directory, 'events.json')
    writeFileSync(script, `
      const { app } = require('electron');
      const { writeFileSync } = require('node:fs');
      const { BaseUpdater } = require(${JSON.stringify(require.resolve('electron-updater/out/BaseUpdater'))});
      const events = [];
      process.on('exit', () => writeFileSync(${JSON.stringify(receipt)} + '.trace', JSON.stringify(events)));
      class TestUpdater extends BaseUpdater {
        doInstall(options) { events.push(['install', options.isSilent, options.isForceRunAfter]); return true; }
      }
      const updater = new TestUpdater();
      updater.logger = null;
      updater.downloadedUpdateHelper = { file: 'test-installer', downloadedFileInfo: {} };
      updater.addQuitHandler();
      app.on('quit', (_event, code) => {
        events.push(['quit', code]);
        writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(events));
      });
      const isUpdating = () => false;
      const setUpdateInstallPreparation = () => {};
      let approved = false;
      const BrowserWindow = { getAllWindows: () => [{ webContents: {
        isDestroyed: () => false, isLoading: () => false,
        executeJavaScript: async () => { events.push(['document', approved]); return approved; },
      } }] };
      const mainLog = console;
      ${new Bun.Transpiler({ loader: 'ts' }).transformSync(coordinator.replace('export function', 'function'))}
      const quitCoordinator = createQuitCoordinator({
        isUpdating,
        prepare: async () => {
          events.push(['prepare']);
          if (${stalls}) await new Promise(() => {});
        },
        onPrepareIncomplete: reason => events.push([reason]),
        exit: code => app.exit(code),
      });
      ${new Bun.Transpiler({ loader: 'ts' }).transformSync(wiring)}
      app.whenReady().then(async () => {
        const beforeQuit = app.listeners('before-quit').at(-1);
        await beforeQuit({ preventDefault() {} });
        events.push(['cancelled']);
        approved = true;
        app.quit();
      });
    `)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron') as string, [...LINUX_CI_SANDBOX_ARGS, script, `--user-data-dir=${directory}/profile`], {
      env, encoding: 'utf8', timeout: 15_000,
    })
    expect({ status: result.status, error: result.error, stderr: result.stderr }).toMatchObject({ status: 0, error: undefined })
    expect(existsSync(receipt), `events before exit: ${readFileSync(`${receipt}.trace`, 'utf8')}\n${result.stderr}`).toBe(true)
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual([
      ['document', false], ['cancelled'], ['document', true], ['prepare'],
      ...(stalls ? [['timed-out']] : []),
      ['install', true, false], ['quit', 0],
    ])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)
