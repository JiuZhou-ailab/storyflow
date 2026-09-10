// input: Built Electron app and an isolated, projectless session filesystem
// output: Conversation file panel, preview, refresh and ownership acceptance checks
// pos: Offline UI-to-RPC regression for Spec #38; no external model calls
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { launchApp, evalOn, waitFor, type LaunchedApp } from '../perf/launch'

const fixture = mkdtempSync(join(tmpdir(), 'storyflow-conversation-files-'))
let app: LaunchedApp | undefined
try {
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { cwd: resolve(import.meta.dirname, '../..'), stdio: 'pipe' })
  const configPath = join(fixture, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.workspaces = []
  delete config.activeWorkspaceId
  writeFileSync(configPath, JSON.stringify(config))
  app = await launchApp(fixture)
  let live = app
  await waitFor(live, `window.electronAPI && document.querySelector('[data-tutorial="activity-profile"]')`)
  await evalOn(live, `window.electronAPI.switchWorkspace('__storyflow_free__')`)
  await evalOn(live, `(() => { const url = new URL(location.href); url.search = '?workspaceId=__storyflow_free__&ws=__storyflow_free__&route=allSessions'; location.href = url.href })()`)
  await waitFor(live, `document.querySelector('[contenteditable="true"]')`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  const toggle = `document.querySelector('button[aria-label="展开右侧栏"]')`
  await waitFor(live, toggle, 8000, 'Free conversations expose the right panel toggle without a project')
  assert.equal(await evalOn(live, `!!document.querySelector('[data-testid="conversation-files"]')`), false)
  await evalOn(live, `${toggle}.click()`)
  await waitFor(live, `document.querySelector('[data-testid="conversation-files"]')?.textContent.includes('本次对话的附件和生成文件会显示在这里')`)
  const sessions = await evalOn<Array<{id: string; workingDirectory: string}>>(live, `window.electronAPI.getSessions()`)
  assert.equal(sessions.length, 1)
  const session = sessions[0]!
  await evalOn(live, `window.electronAPI.sessionCommand(${JSON.stringify(session.id)}, {type:'rename',name:'文件验收A'})`)
  await waitFor(live, `document.body.textContent.includes('文件验收A')`)
  const file = join(session.workingDirectory, '验收报告.txt')
  writeFileSync(file, '第一版报告')
  const fileButton = `Array.from(document.querySelectorAll('[data-testid="conversation-files"] button')).find(e=>e.textContent==='验收报告.txt')`
  await waitFor(live, fileButton, 5000, 'A new work file appears without reopening')
  await evalOn(live, `${fileButton}.click()`)
  await waitFor(live, `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('第一版报告')`)
  writeFileSync(file, '第二版报告')
  await waitFor(live, `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('第二版报告')`)
  rmSync(file)
  await waitFor(live, `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('文件已不存在')`)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-testid="conversation-preview"] [contenteditable="true"]')`), false)
  console.log('PASS: projectless empty panel → real file refresh → read-only preview → deletion')

  const sessionFolder = dirname(session.workingDirectory)
  const original = join(sessionFolder, 'attachments', 'source.txt')
  writeFileSync(original, '不可变的原始材料')
  writeFileSync(join(sessionFolder, 'attachments', 'converted.txt'), '不展示转换副本')
  writeFileSync(join(sessionFolder, 'plans', 'internal.md'), '不展示内部计划')
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal(await evalOn(live, `document.querySelector('[data-testid="conversation-files"]').textContent.includes('source.txt')`), false, 'Unsent attachments stay out')
  const transcript = join(sessionFolder, 'session.jsonl')
  const stored = { id: 'attachment-source', type: 'text', name: '原始材料.txt', storedPath: original, size: 27, mimeType: 'text/plain' }
  appendFileSync(transcript, [
    { id: 'without-material', type: 'user', content: '没有附件', timestamp: Date.now(), attachments: null },
    { id: 'sent-material', type: 'user', content: '查看材料', timestamp: Date.now(), attachments: [null, stored, stored] },
  ].map(message => JSON.stringify(message)).join('\n') + '\n')
  const originalButton = `Array.from(document.querySelectorAll('[data-testid="conversation-files"] button')).find(e=>e.textContent==='原始材料.txt')`
  await waitFor(live, originalButton, 5000, 'Persisting a user message exposes the already-created original')
  assert.equal(await evalOn(live, `Array.from(document.querySelectorAll('[data-testid="conversation-files"] button')).filter(e=>e.textContent==='原始材料.txt').length`), 1)
  await evalOn(live, `${originalButton}.click()`)
  await waitFor(live, `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('不可变的原始材料')`)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-testid="conversation-preview"] button[aria-label="打开"]')`), false)
  assert.equal(await evalOn(live, `/converted|internal/.test(document.querySelector('[data-testid="conversation-files"]').textContent)`), false)

  const backup = readFileSync(transcript, 'utf8')
  writeFileSync(transcript, '{invalid')
  await waitFor(live, `document.querySelector('[data-testid="conversation-files"] [role="alert"]')`)
  writeFileSync(transcript, backup)
  await evalOn(live, `Array.from(document.querySelectorAll('[data-testid="conversation-files"] button')).find(e=>e.textContent==='重试').click()`)
  await waitFor(live, originalButton)
  console.log('PASS: sent originals only, deduplication, read-only attachment, error/retry')

  await evalOn(live, `document.querySelector('button[aria-label="新建自由对话"]').click()`)
  await waitFor(live, `document.querySelector('[data-testid="conversation-files"]')?.dataset.sessionId && document.querySelector('[data-testid="conversation-files"]').dataset.sessionId !== ${JSON.stringify(session.id)}`)
  const nextId = await evalOn<string>(live, `document.querySelector('[data-testid="conversation-files"]').dataset.sessionId`)
  const next = (await evalOn<Array<{ id: string; workingDirectory: string }>>(live, `window.electronAPI.getSessions()`)).find(value => value.id === nextId)!
  await evalOn(live, `window.electronAPI.sessionCommand(${JSON.stringify(next.id)}, {type:'rename',name:'文件验收B'})`)
  await waitFor(live, `document.body.textContent.includes('文件验收B')`)
  writeFileSync(join(next.workingDirectory, '会话B.txt'), '仅属于会话B')
  const navigate = async (id: string) => {
    await evalOn(live, `window.dispatchEvent(new CustomEvent('craft-agent-navigate', {detail:{route:'allSessions/session/${id}'}}))`)
    await waitFor(live, `document.querySelector('[data-testid="conversation-files"]')?.dataset.sessionId === ${JSON.stringify(id)}`)
  }
  await navigate(next.id)
  const bButton = `Array.from(document.querySelectorAll('[data-testid="conversation-files"] button')).find(e=>e.textContent==='会话B.txt')`
  await waitFor(live, bButton)
  assert.equal(await evalOn(live, `document.querySelector('[data-testid="conversation-files"]').textContent.includes('原始材料')`), false)
  await evalOn(live, `${bButton}.click()`)
  await waitFor(live, `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('仅属于会话B')`)
  await navigate(session.id)
  await waitFor(live, originalButton)
  assert.equal(await evalOn(live, `document.querySelector('[data-testid="conversation-preview"]').textContent.trim()`), '选择文件以预览')
  // Rapid real RPC queries must never repaint an earlier conversation after navigation settles.
  for (let i = 0; i < 4; i++) {
    await navigate(next.id)
    await navigate(session.id)
  }
  await waitFor(live, originalButton)
  await new Promise(resolve => setTimeout(resolve, 800))
  assert.equal(await evalOn(live, `document.querySelector('[data-testid="conversation-files"]').textContent.includes('会话B')`), false)
  assert.equal(readFileSync(original, 'utf8'), '不可变的原始材料')
  console.log('PASS: switch/rapid-switch isolation and no restored preview or original mutation')

  await live.cdp.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 850, deviceScaleFactor: 1, mobile: false }, live.sid)
  const info = `document.querySelector('button[aria-label="会话信息"]')`
  await waitFor(live, info)
  await evalOn(live, `${info}.click()`)
  await waitFor(live, originalButton)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-panel-role="conversation-files"]')`), false)
  console.log('PASS: compact mode reuses the conversation file drawer')

  // Load real persisted chat links through a fresh window, with no agent/provider calls.
  await live.close()
  app = undefined
  writeFileSync(file, '链接目标报告')
  const sibling = join(session.workingDirectory, '旁边文件.json')
  writeFileSync(sibling, '{"name":"旁边内容"}')
  const denied = join(session.workingDirectory, '读取重试.txt')
  writeFileSync(denied, '重试读取成功')
  const messages = backup.trim().split('\n').map(line => JSON.parse(line))
  messages[0].messageCount = 3
  messages[0].lastFinalMessageId = 'file-link-reply'
  messages.push({ id: 'file-link-reply', type: 'assistant', content: `[打开报告](${file})`, timestamp: Date.now(), isIntermediate: false })
  writeFileSync(transcript, messages.map(message => JSON.stringify(message)).join('\n') + '\n')
  app = await launchApp(fixture)
  live = app
  await waitFor(live, `window.electronAPI && document.querySelector('[data-tutorial="activity-profile"]')`)
  await evalOn(live, `(() => { const url = new URL(location.href); url.search = '?workspaceId=__storyflow_free__&ws=__storyflow_free__&route=allSessions/session/${session.id}'; location.href = url.href })()`)
  const link = `Array.from(document.querySelectorAll('a')).find(e=>e.textContent==='打开报告')`
  await waitFor(live, link)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  // Capture only OS action RPCs at the preload transport, so the test never launches an editor/Finder.
  const contexts: Array<{ id: number; name: string }> = []
  live.cdp.on('Runtime.executionContextCreated', event => contexts.push(event.context))
  await live.cdp.send('Runtime.disable', {}, live.sid)
  await live.cdp.send('Runtime.enable', {}, live.sid)
  const preload = contexts.find(context => context.name === 'Electron Isolated Context')
  assert.ok(preload, 'The real preload execution context is available')
  const capture = await live.cdp.send('Runtime.evaluate', { contextId: preload.id, expression: `(() => {
    globalThis.__fileActions = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      const message = JSON.parse(data);
      if (message.type === 'request' && ['shell:openFile','shell:showInFolder'].includes(message.channel)) {
        globalThis.__fileActions.push({channel:message.channel,args:message.args});
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify({id:message.id,type:'response',result:undefined})})));
        return;
      }
      return send.call(this,data);
    };
  })()` }, live.sid)
  assert.equal(capture.exceptionDetails, undefined)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-testid="conversation-files"]')`), false, 'A fresh window defaults closed')
  await evalOn(live, `${link}.click()`)
  const reportVisible = `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('链接目标报告')`
  await waitFor(live, reportVisible)
  const siblingButton = `Array.from(document.querySelectorAll('[data-testid="conversation-files"] button')).find(e=>e.textContent==='旁边文件.json')`
  await evalOn(live, `${siblingButton}.click()`)
  await waitFor(live, `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('旁边内容')`)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-testid="conversation-preview"] button[aria-label="打开"]')`), true, 'JSON has the same system-open action')
  await evalOn(live, `document.querySelector('[data-testid="conversation-preview"] button[aria-label="打开"]').click(); document.querySelector('[data-testid="conversation-preview"] button[aria-label="打开文件位置"]').click()`)
  const actions = await live.cdp.send('Runtime.evaluate', { contextId: preload.id, expression: 'globalThis.__fileActions', returnByValue: true }, live.sid)
  assert.deepEqual(actions.result.value, [{channel:'shell:openFile',args:[sibling]}, {channel:'shell:showInFolder',args:[sibling]}])
  await evalOn(live, `${link}.click()`)
  await waitFor(live, reportVisible, 5000, 'Repeated chat link reselects the original file')

  await evalOn(live, `void (window.__previewBeforeRefresh = document.querySelector('[data-file-viewer-kind]'))`)
  writeFileSync(sibling, '{"name":"新旁边内容"}')
  writeFileSync(join(session.workingDirectory, '刷新标记.txt'), '仅刷新目录')
  await waitFor(live, `document.querySelector('[data-testid="conversation-files"]').textContent.includes('刷新标记.txt')`)
  assert.equal(await evalOn(live, `window.__previewBeforeRefresh === document.querySelector('[data-file-viewer-kind]')`), true, 'Sibling changes preserve the active preview instance')

  chmodSync(denied, 0)
  await evalOn(live, `Array.from(document.querySelectorAll('[data-testid="conversation-files"] button')).find(e=>e.textContent==='读取重试.txt').click()`)
  await waitFor(live, `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('EACCES')`)
  chmodSync(denied, 0o600)
  await evalOn(live, `document.querySelector('[data-testid="conversation-preview"] button[aria-label="重试"]').click()`)
  await waitFor(live, `document.querySelector('[data-testid="conversation-preview"]')?.textContent.includes('重试读取成功')`)
  console.log('PASS: repeated chat link, JSON system-open action, stable preview, filesystem read retry')

  await evalOn(live, `${link}.click()`)
  await waitFor(live, reportVisible)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  await waitFor(live, `!document.querySelector('[role="dialog"]')`)
  const shot = await live.cdp.send('Page.captureScreenshot', { format: 'png' }, live.sid) as { data: string }
  writeFileSync('/tmp/storyflow-38-conversation-files.png', Buffer.from(shot.data, 'base64'))
  await evalOn(live, `document.querySelector('[data-testid="conversation-files"] button[aria-label="收起右侧栏"]').click()`)
  await live.cdp.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 850, deviceScaleFactor: 1, mobile: false }, live.sid)
  await waitFor(live, info)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-testid="conversation-files"]')`), false, 'Layout changes never replay an already-consumed link intent')
  await evalOn(live, `${link}.click()`)
  await waitFor(live, reportVisible)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-panel-role="conversation-files"]')`), false)
  assert.equal(await evalOn(live, `!!document.querySelector('[role="dialog"] [data-testid="conversation-preview"]')`), true)
  await live.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }, live.sid)
  await live.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }, live.sid)
  await live.cdp.send('Emulation.clearDeviceMetricsOverride', {}, live.sid)
  await waitFor(live, toggle)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-testid="conversation-files"]')`), false, 'Closing the compact drawer does not open the desktop dock')
  console.log('PASS: compact chat link opens the drawer and selects its target')
} catch (error) {
  if (app) console.error(await evalOn(app, `document.body.innerText.slice(-5000)`))
  throw error
} finally {
  await app?.close()
  rmSync(fixture, { recursive: true, force: true })
}
