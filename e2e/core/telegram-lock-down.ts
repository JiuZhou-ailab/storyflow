// input: Built Electron app, isolated messaging files, synthetic Telegram connection status
// output: Lock-down error and success toasts plus access state after a full restart
// pos: Offline desktop acceptance for Telegram lock-down persistence
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { BindingStore, ConfigStore } from '@craft-agent/messaging-gateway'
import { evalOn, launchApp, waitFor, type LaunchedApp } from '../perf/launch'

const repo = resolve(import.meta.dirname, '../..')
const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo, encoding: 'utf8' }).trim()
const scratch = join(gitDir, 'tmp')
mkdirSync(scratch, { recursive: true })
const base = realpathSync(mkdtempSync(join(scratch, 'telegram-lock-down-')))
const fixture = join(base, 'config')
const rendererReady = `window.electronAPI && document.querySelector('[data-tutorial="activity-profile"]')`
const lockDownButton = `Array.from(document.querySelectorAll('button')).find(b => /^(Lock down|锁定)$/.test(b.textContent.trim()))`
const successMessages = ['Telegram bot locked down to allowed users', 'Telegram 机器人已限定为允许的用户']
const toastVisible = (type: 'error' | 'success', ...messages: string[]) =>
  `Array.from(document.querySelectorAll('[data-sonner-toast][data-type="${type}"]')).some(t =>
    ${JSON.stringify(messages)}.some(message => t.textContent.includes(message)))`

async function openMessaging(app: LaunchedApp) {
  await waitFor(app, rendererReady)
  // Simulate only connection status so the real Settings UI renders the button.
  // All reads and writes of access policy still go through the app's Host RPC.
  const contexts: Array<{ id: number; name: string }> = []
  app.cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context))
  await app.cdp.send('Runtime.disable', {}, app.sid)
  await app.cdp.send('Runtime.enable', {}, app.sid)
  const preload = contexts.find(context => context.name === 'Electron Isolated Context')
  assert.ok(preload)
  const result = await app.cdp.send('Runtime.evaluate', {
    contextId: preload.id,
    expression: `(() => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function(data) {
        const request = JSON.parse(data);
        if (request.type !== 'request' || request.channel !== ${JSON.stringify(RPC_CHANNELS.messaging.GET_CONFIG)}) {
          return send.call(this, data);
        }
        const result = { runtime: { telegram: { configured: true, connected: true, state: 'connected' } } };
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ type: 'response', id: request.id, result })
        })));
      };
    })()`,
  }, app.sid)
  assert.equal(result.exceptionDetails, undefined)
  await evalOn(app, `window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route: 'settings/messaging' } }))`)
  await waitFor(app, `/Allowed users|允许的用户/.test(document.body.innerText)`)
}

let app: LaunchedApp | undefined
let passed = false
try {
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { cwd: repo })
  const { activeWorkspaceId } = JSON.parse(readFileSync(join(fixture, 'config.json'), 'utf8'))
  const storage = join(fixture, '.craft-agent', 'workspaces', activeWorkspaceId, 'messaging')
  new ConfigStore(storage).update({ platforms: { telegram: { enabled: true, accessMode: 'open' } } })
  const binding = new BindingStore(storage).bind(activeWorkspaceId, 'legacy-session', 'telegram', 'legacy-chat', undefined, {
    accessMode: 'open',
  })
  const launchOptions = { userDataDir: join(base, 'electron-profile'), processLogPath: join(base, 'electron.log') }
  app = await launchApp(fixture, launchOptions)
  await openMessaging(app)
  const readMode = `window.electronAPI.getMessagingPlatformAccessMode('telegram')`
  assert.equal(await evalOn(app, readMode), 'open')

  for (const [file, message] of [
    ['bindings.json', 'Failed to save messaging bindings.'],
    ['config.json', 'Failed to save messaging config.'],
  ]) {
    const path = join(storage, file)
    const saved = `${path}.saved`
    renameSync(path, saved)
    mkdirSync(path)
    try {
      await evalOn(app, `${lockDownButton}.click()`)
      await waitFor(app, toastVisible('error', message))
      assert.equal(await evalOn(app, toastVisible('success', ...successMessages)), false)
      assert.equal(await evalOn(app, `Boolean(${lockDownButton})`), true)
      assert.equal(await evalOn(app, readMode), 'open')
    } finally {
      rmSync(path, { recursive: true })
      renameSync(saved, path)
    }
  }

  await evalOn(app, `${lockDownButton}.click()`)
  await waitFor(app, toastVisible('success', ...successMessages))
  await waitFor(app, `!${lockDownButton}`)
  await app.close()
  app = undefined

  app = await launchApp(fixture, launchOptions)
  await waitFor(app, rendererReady)
  assert.equal(await evalOn(app, readMode), 'owner-only')
  const bindings = await evalOn<Array<{ id: string; accessMode: string }>>(app, `window.electronAPI.getMessagingBindings()`)
  assert.equal(bindings.find(row => row.id === binding.id)?.accessMode, 'inherit')
  passed = true
  console.log('PASS: both failure toasts, success after retry, and owner-only policy after Electron restart')
} catch (error) {
  console.error(`Telegram lock-down fixture and process log retained at ${base}`)
  if (app) console.error(await evalOn(app, `document.body.innerText.slice(0, 600)`).catch(() => ''))
  throw error
} finally {
  await app?.close()
  if (passed) rmSync(base, { recursive: true, force: true })
}
