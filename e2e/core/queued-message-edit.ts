// input: Built Electron app, isolated Project, and a paused loopback model
// output: Queued-message edit, resend, and attachment-read failure assertions
// pos: Desktop regression check through the composer and real Session Host

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Message } from '@craft-agent/core/types'
import { launchApp, evalOn, callOn, waitFor, type LaunchedApp } from '../perf/launch'

const temporaryDir = join(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim(), 'tmp')
mkdirSync(temporaryDir, { recursive: true })
const fixture = mkdtempSync(join(temporaryDir, 'queued-message-edit-'))
const connection = 'queued-edit-fixture'
const activeTurn = Promise.withResolvers<void>()
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM////ZwAAHu8E/KPItPcAAAAASUVORK5CYII='
let app: LaunchedApp | undefined
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request) {
    if (!new URL(request.url).pathname.endsWith('/chat/completions')) return new Response(null, { status: 404 })
    await activeTurn.promise
    return new Response(null, { status: 503 })
  },
})

try {
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { stdio: 'pipe' })
  const configPath = join(fixture, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const workspace = config.workspaces[0]
  config.llmConnections = [{
    slug: connection, name: 'Queued edit fixture', providerType: 'pi_compat',
    baseUrl: `http://127.0.0.1:${server.port}/v1`, authType: 'none', models: [connection],
    defaultModel: connection, customEndpoint: { api: 'openai-completions', supportsImages: true }, createdAt: Date.now(),
  }]
  config.defaultLlmConnection = connection
  writeFileSync(configPath, JSON.stringify(config))
  app = await launchApp(fixture)
  const live = app
  await waitFor(live, `document.querySelector('[data-tutorial="activity-profile"]')`)
  const sessionId = await callOn<string>(live, `async function(workspaceId, connection) {
    await window.electronAPI.switchWorkspace(workspaceId);
    const session = await window.electronAPI.createSession(workspaceId, {
      name: 'Queued edit fixture', permissionMode: 'safe', llmConnection: connection, model: connection,
    });
    const url = new URL(location.href);
    url.search = new URLSearchParams({ workspaceId, ws: workspaceId, route: 'allSessions/session/' + session.id }).toString();
    setTimeout(() => { location.href = url.href; }, 0);
    return session.id;
  }`, [workspace.id, connection])

  const composer = `document.querySelector('[data-tutorial="chat-input"][contenteditable="true"]')`
  const editButtons = `document.querySelectorAll('button[aria-label="编辑排队消息"],button[aria-label="Edit queued message"]')`
  const preview = (name: string) => `(${composer})?.closest('form')?.querySelector('img[alt="${name}"]')`
  const getQueued = async (expectedSize: number) => {
    // The renderer can show the optimistic queue row before the Host commits it.
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const session = await callOn<{ messages: Message[] }>(
        live, `async function(id) { return window.electronAPI.getSessionMessages(id) }`, [sessionId],
      )
      const queued = session.messages.filter(message => message.isQueued)
      if (queued.length === expectedSize) return queued
      await Bun.sleep(50)
    }
    throw new Error(`Expected ${expectedSize} queued messages on the Host`)
  }
  const typeText = async (text: string) => {
    await evalOn(live, `(${composer}).focus()`)
    await live.cdp.send('Input.insertText', { text }, live.sid)
  }
  const send = async () => {
    await evalOn(live, `(${composer}).focus()`)
    for (const type of ['keyDown', 'keyUp']) {
      await live.cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, live.sid)
    }
  }
  const dropImages = async (...names: string[]) => {
    await callOn(live, `function(png, names) {
      const bytes = Uint8Array.fromBase64(png);
      const dataTransfer = new DataTransfer();
      for (const name of names) dataTransfer.items.add(new File([bytes], name, { type: 'image/png' }));
      (${composer}).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    }`, [png, names])
    for (const name of names) await waitFor(live, preview(name))
  }
  const waitForQueueSize = (size: number) => waitFor(live, `${editButtons}.length === ${size}`)

  await waitFor(live, `(${composer}) && !document.querySelector('.z-splash')`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  await live.cdp.send('Page.bringToFront', {}, live.sid)
  await typeText('保持本轮执行中')
  await send()

  await dropImages('image-only.png')
  await send()
  await waitForQueueSize(1)
  const [original] = await getQueued(1)
  assert.equal(original?.content, '')
  assert.equal(original.attachments?.[0]?.name, 'image-only.png')
  await evalOn(live, `${editButtons}[0].click()`)
  await waitFor(live, `${preview('image-only.png')} && ${editButtons}.length === 0`, 5_000, 'Attachment-only edit restores the image')
  assert.equal(await evalOn(live, `(${composer}).textContent`), '')
  await send()
  await waitForQueueSize(1)
  const [resent] = await getQueued(1)
  assert.notEqual(resent?.id, original.id)
  assert.equal(resent.attachments?.[0]?.name, 'image-only.png')
  assert.equal(readFileSync(resent.attachments![0]!.storedPath).toString('base64'), png)
  console.log('PASS: attachment-only edit restores and resends the original image bytes')

  await typeText('正文与附件')
  await dropImages('with-text.png')
  await send()
  await waitForQueueSize(2)
  await getQueued(2)
  await evalOn(live, `${editButtons}[1].click()`)
  await waitFor(live, `${preview('with-text.png')} && (${composer}).textContent === '正文与附件' && ${editButtons}.length === 1`)
  console.log('PASS: edit restores both text and attachment')

  await dropImages('missing.png')
  await send()
  await waitForQueueSize(2)
  const missing = (await getQueued(2))[1]!
  assert.deepEqual(missing.attachments?.map(attachment => attachment.name), ['with-text.png', 'missing.png'])
  unlinkSync(missing.attachments![1]!.storedPath)
  await evalOn(live, `${editButtons}[1].click()`)
  await waitFor(live, `Array.from(document.querySelectorAll('[data-sonner-toast][data-type="error"]')).some(toast => toast.textContent.includes('missing.png'))`)
  await waitForQueueSize(2)
  assert.deepEqual((await getQueued(2))[1], missing)
  assert.equal(await evalOn(live, `(${composer}).textContent === '' && !${preview('with-text.png')} && !${preview('missing.png')}`), true)
  console.log('PASS: one missing original keeps the whole queued message and leaves the composer untouched')
} catch (error) {
  console.error(app?.processLines.slice(-20).join('\n'))
  throw error
} finally {
  activeTurn.resolve()
  await app?.close()
  server.stop(true)
  rmSync(fixture, { recursive: true, force: true })
}
