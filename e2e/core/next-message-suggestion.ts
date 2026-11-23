// input: Built Electron app, isolated Project, and loopback chat and mini models
// output: Assertions for ghost text, Tab acceptance, and a draft typed during inference
// pos: Desktop regression check across the composer, Session Host and Pi

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, evalOn, callOn, waitFor, type LaunchedApp } from '../perf/launch'

const temporaryDir = join(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim(), 'tmp')
mkdirSync(temporaryDir, { recursive: true })
const fixture = mkdtempSync(join(temporaryDir, 'next-message-'))
const connection = 'suggestion-e2e'
const miniModel = 'suggestion-mini'
const suggestion = '请展开第一步。'
const manualDraft = '我想验证另一条路线。'
const pendingSecondSuggestion = Promise.withResolvers<void>()
const requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = []
let suggestionCalls = 0
let app: LaunchedApp | undefined
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith('/chat/completions')) return new Response(null, { status: 404 })
  const body = await request.json() as typeof requests[number]
  requests.push(body)
  const isSuggestion = body.messages.some(message => message.role === 'system' && JSON.stringify(message.content).includes('Predict the next short message'))
  if (isSuggestion && ++suggestionCalls === 2) await pendingSecondSuggestion.promise
  const isAcceptedDraft = body.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes(suggestion))
  const content = isSuggestion ? suggestion : isAcceptedDraft ? '这里是第一步的细节。' : '可以先试第一步。'
  const sse = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({
    id: 'suggestion-fixture', model: body.model, choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`
  return new Response(sse({ content }, null) + sse({}, 'stop') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })
} })

try {
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { stdio: 'pipe' })
  const configPath = join(fixture, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const workspace = config.workspaces[0]
  config.llmConnections = [{
    slug: connection, name: 'Suggestion fixture', providerType: 'pi_compat',
    baseUrl: `http://127.0.0.1:${server.port}/v1`, authType: 'none', models: [connection, miniModel],
    defaultModel: connection, customEndpoint: { api: 'openai-completions' }, createdAt: Date.now(),
  }]
  config.defaultLlmConnection = connection
  writeFileSync(configPath, JSON.stringify(config))
  app = await launchApp(fixture)
  const live = app
  await waitFor(live, `document.querySelector('[data-tutorial="activity-profile"]')`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  const sessionId = await callOn<string>(live, `async function(workspaceId, connection) {
    await window.electronAPI.switchWorkspace(workspaceId);
    const session = await window.electronAPI.createSession(workspaceId, {
      name: 'Suggestion fixture', permissionMode: 'safe', llmConnection: connection, model: connection,
    });
    const url = new URL(location.href);
    url.search = new URLSearchParams({ workspaceId, ws: workspaceId, route: 'allSessions/session/' + session.id }).toString();
    setTimeout(() => { location.href = url.href; }, 0);
    return session.id;
  }`, [workspace.id, connection])
  const composer = `document.querySelector('[data-tutorial="chat-input"][contenteditable="true"]')`
  const ghost = `document.getElementById((${composer})?.getAttribute('aria-describedby'))`
  const waitForSuggestion = () => waitFor(live,
    `(${ghost})?.textContent === ${JSON.stringify(suggestion + 'Tab')}`, 20_000, 'Visible draft suggestion with Tab hint')
  const press = async (key: string, windowsVirtualKeyCode: number, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) {
      await live.cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode, modifiers }, live.sid)
    }
  }
  const getSession = () => callOn<{ isProcessing: boolean; messages: Array<{ role: string; content: string }> }>(
    live, `async function(id) { return window.electronAPI.getSessionMessages(id) }`, [sessionId],
  )

  await waitFor(live, `(${composer}) && !document.querySelector('.z-splash')`)
  await live.cdp.send('Page.bringToFront', {}, live.sid)
  await evalOn(live, `(${composer}).focus()`)
  await live.cdp.send('Input.insertText', { text: '给我一种入门方式。' }, live.sid)
  await press('Enter', 13)
  await waitForSuggestion()
  assert.equal(await evalOn(live, `(${composer}).textContent`), '')
  assert.equal(await evalOn(live, `getComputedStyle((${ghost})).pointerEvents`), 'none')
  const miniRequest = requests.find(request => request.model === miniModel)!
  assert.ok(miniRequest.messages.some(message => {
    const content = JSON.stringify(message.content)
    return content.includes('给我一种入门方式。') && content.includes('可以先试第一步。')
  }))

  await evalOn(live, `(${composer}).focus()`)
  await press('Tab', 9)
  await waitFor(live, `(${composer}).textContent === ${JSON.stringify(suggestion)} && !(${ghost})`)
  assert.equal(await evalOn(live, `window.getSelection().anchorOffset`), suggestion.length)
  assert.deepEqual((await getSession()).messages.filter(message => message.role === 'user').map(message => message.content), ['给我一种入门方式。'])

  await press('Enter', 13)
  await waitFor(live, `document.body.textContent.includes('这里是第一步的细节。') && (${composer})?.textContent === ''`)
  await evalOn(live, `(${composer}).focus()`)
  await live.cdp.send('Input.insertText', { text: manualDraft }, live.sid)
  await evalOn(live, `(() => {
    const off = window.electronAPI.onSessionEvent(event => {
      if (event.type === 'next_message_suggested') {
        off();
        document.body.dataset.suggestionReceived = 'true';
      }
    });
  })()`)
  pendingSecondSuggestion.resolve()
  await waitFor(live, `document.body.dataset.suggestionReceived === 'true'`)
  assert.equal(await evalOn(live, `(${composer}).textContent`), manualDraft)
  assert.equal(await evalOn(live, `(${composer}).getAttribute('aria-keyshortcuts')`), null)
  await press('Tab', 9)
  assert.equal(await evalOn(live, `document.activeElement === (${composer})`), false)
  assert.equal(suggestionCalls, 2)
  console.log('PASS: completed replies use the mini model, Tab inserts without sending, late results preserve drafts')
} catch (error) {
  console.error(app?.processLines.slice(-25).join('\n'))
  throw error
} finally {
  pendingSecondSuggestion.resolve()
  await app?.close()
  server.stop(true)
  rmSync(fixture, { recursive: true, force: true })
}
