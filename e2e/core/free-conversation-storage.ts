// input: Built Electron application and isolated session storage
// output: Settings-to-RPC, restart migration, backup and old-path acceptance
// pos: Offline end-to-end verification for Free Conversation storage relocation
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp, evalOn, waitFor, type LaunchedApp } from '../perf/launch'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'storyflow-free-storage-e2e-')))
const fixture = join(base, 'config'), parent = join(base, 'chosen')
mkdirSync(parent)
let app: LaunchedApp | undefined
try {
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { cwd: resolve(import.meta.dirname, '../..'), stdio: 'pipe' })
  const configPath = join(fixture, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.workspaces = []; delete config.activeWorkspaceId
  writeFileSync(configPath, JSON.stringify(config))
  app = await launchApp(fixture)
  await waitFor(app, `window.electronAPI && document.querySelector('[data-tutorial="activity-profile"]')`)
  const session = await evalOn<{id: string; workingDirectory: string}>(app, `window.electronAPI.createSession('__storyflow_free__')`)
  const file = join(session.workingDirectory, 'storage-acceptance.md')
  mkdirSync(session.workingDirectory, { recursive: true }); writeFileSync(file, '持久化成果\n')
  await evalOn(app, `window.electronAPI.switchWorkspace('__storyflow_free__')`)
  await evalOn(app, `(() => { const url = new URL(location.href); url.search = '?workspaceId=__storyflow_free__&ws=__storyflow_free__&route=allSessions'; location.href = url.href })()`)
  await waitFor(app, `document.querySelector('[contenteditable="true"]')`)
  await evalOn(app, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  await evalOn(app, `window.dispatchEvent(new CustomEvent('craft-agent-navigate', {detail:{route:'settings/app'}}))`)
  await waitFor(app, `Array.from(document.querySelectorAll('button')).some(b => b.textContent === '选择文件夹' && !b.disabled)`)
  await evalOn(app, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  // Substitute only the native picker; use the actual settings button, transport and Host handler.
  const contexts: Array<{ id: number; name: string }> = []
  app.cdp.on('Runtime.executionContextCreated', event => contexts.push(event.context))
  await app.cdp.send('Runtime.disable', {}, app.sid)
  await app.cdp.send('Runtime.enable', {}, app.sid)
  const preload = contexts.find(context => context.name === 'Electron Isolated Context')
  assert.ok(preload)
  const capture = await app.cdp.send('Runtime.evaluate', { contextId: preload.id, expression: `(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      const message = JSON.parse(data);
      if (message.type === 'request' && message.channel === 'dialog:openFolder') {
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify({id:message.id,type:'response',result:${JSON.stringify(parent)}})})));
        return;
      }
      return send.call(this,data);
    };
  })()` }, app.sid)
  assert.equal(capture.exceptionDetails, undefined)
  await evalOn(app, `Array.from(document.querySelectorAll('button')).find(b => b.textContent === '选择文件夹').click()`)
  await waitFor(app, `document.body.textContent.includes('下次启动时迁移到')`)
  const pending = await evalOn<any>(app, `window.electronAPI.getFreeConversationStorage()`)
  assert.equal(pending.pendingPath, join(parent, 'storyflow-free-conversations'))
  assert.equal(readFileSync(file, 'utf8'), '持久化成果\n')
  await app.close(); app = undefined
  app = await launchApp(fixture)
  await waitFor(app, `window.electronAPI && document.querySelector('[data-tutorial="activity-profile"]')`)
  const moved = await evalOn<any>(app, `window.electronAPI.getFreeConversationStorage()`)
  assert.equal(moved.path, pending.pendingPath)
  assert.equal(moved.pendingPath, undefined)
  assert.ok(moved.backupPath)
  assert.equal(readFileSync(file, 'utf8'), '持久化成果\n')
  const sessions = await evalOn<any[]>(app, `window.electronAPI.getSessions()`)
  assert.ok(sessions.some(s => s.id === session.id))
  await evalOn(app, `window.electronAPI.switchWorkspace('__storyflow_free__')`)
  await evalOn(app, `(() => { const url = new URL(location.href); url.search = '?workspaceId=__storyflow_free__&ws=__storyflow_free__&route=allSessions'; location.href = url.href })()`)
  await waitFor(app, `document.querySelector('[contenteditable="true"]')`)
  await evalOn(app, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  await evalOn(app, `window.dispatchEvent(new CustomEvent('craft-agent-navigate', {detail:{route:'settings/app'}}))`)
  await waitFor(app, `document.body.textContent.includes('原存储备份')`)
  const secondParent = join(base, 'second'); mkdirSync(secondParent)
  await evalOn(app, `window.electronAPI.setFreeConversationStorage(${JSON.stringify(secondParent)})`)
  await app.close(); app = undefined
  app = await launchApp(fixture)
  await waitFor(app, `window.electronAPI && document.querySelector('[data-tutorial="activity-profile"]')`)
  const second = await evalOn<any>(app, `window.electronAPI.getFreeConversationStorage()`)
  assert.equal(second.path, join(secondParent, 'storyflow-free-conversations'))
  await app.close(); app = undefined
  renameSync(parent, join(base, 'first-disk-offline'))
  app = await launchApp(fixture)
  await waitFor(app, `window.electronAPI && document.querySelector('[data-tutorial="activity-profile"]')`)
  assert.equal(readFileSync(file, 'utf8'), '持久化成果\n')
  assert.equal((await evalOn<any>(app, `window.electronAPI.getFreeConversationStorage()`)).path, second.path)
  assert.ok((await evalOn<any[]>(app, `window.electronAPI.getSessions()`)).some(s => s.id === session.id))
  console.log('PASS: settings, RPC, two moves, previous disk offline, retained content and restored session')
} catch (error) {
  if (app) console.error(await evalOn(app, `document.body.innerText.slice(0,4000)`))
  throw error
} finally {
  await app?.close()
  rmSync(base, { recursive: true, force: true })
}
