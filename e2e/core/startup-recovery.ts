// input: Repo-built Electron app and a generated, isolated session fixture
// output: Offline startup/restart and source-specific permission checks for conversation composers
// pos: Regression guard for session recovery independent of the project file pane

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp, evalOn, waitFor, type LaunchedApp } from '../perf/launch'

const root = resolve(import.meta.dirname, '../..')
const temporaryRoot = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'tmp'], { cwd: root, encoding: 'utf8' }).trim()
mkdirSync(temporaryRoot, { recursive: true })
const fixture = mkdtempSync(join(temporaryRoot, 'storyflow-startup-recovery-'))
let live: LaunchedApp | undefined
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function waitForComposer(app: LaunchedApp): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await evalOn(app, `!!document.querySelector('[contenteditable="true"]')`)) return
    await pause(150)
  }
  const state = await evalOn(app, `({url:location.href,placeholder:document.querySelector('[data-testid="writing-chat-placeholder"]')?.innerText})`)
  const runtime = await evalOn(app, `(async () => ({
    workspaceId: await window.electronAPI.getWindowWorkspace(),
    sessions: (await window.electronAPI.getSessions()).map(s => ({id:s.id,workspaceId:s.workspaceId})),
  }))()`).catch(error => ({ error: String(error) }))
  assert.fail(`Conversation did not become usable: ${JSON.stringify({ state, runtime, process: app.processLines.slice(-40) })}`)
}

async function openRoute(app: LaunchedApp, route: string) {
  await evalOn(app, `(() => { const url = new URL(location.href); url.searchParams.delete('panels'); url.searchParams.set('route', ${JSON.stringify(route)}); location.href = url.href })()`)
  await pause(1500)
  await waitForComposer(app)
}

try {
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { cwd: root, stdio: 'pipe' })
  live = await launchApp(fixture, { preserveServerLockState: true, userDataDir: join(fixture, 'electron-profile') })
  await pause(6000)
  await evalOn(live, `localStorage.setItem('craft-writing-workspace-visible', 'false')`)
  await openRoute(live, 'writing')
  console.log('PASS: project conversation loads with the file pane closed')

  const ids = await evalOn<string[]>(live, `(async () => (await window.electronAPI.getSessions()).filter(s => !s.hidden && !s.isArchived).map(s => s.id))()`)
  assert.ok(ids.length >= 2)
  await openRoute(live, 'allSessions/session/' + ids[1])
  assert.equal(await evalOn(live, `new URL(location.href).searchParams.get('route')`), 'allSessions/session/' + ids[1])
  await openRoute(live, 'writing')
  const remembered = await evalOn<string>(live, `new URL(location.href).searchParams.get('route')`)
  assert.equal(remembered, 'allSessions/session/' + ids[1])
  console.log('PASS: project landing restores the last selected conversation')

  await live.close()
  live = undefined
  const saved = JSON.parse(readFileSync(join(fixture, 'window-state.json'), 'utf8'))
  assert.equal(new URL(saved.windows[0].url).searchParams.get('route'), remembered)
  live = await launchApp(fixture, { preserveServerLockState: true, userDataDir: join(fixture, 'electron-profile') })
  await waitForComposer(live)
  assert.equal(await evalOn(live, `new URL(location.href).searchParams.get('route')`), remembered)
  console.log('PASS: cold restart restores the saved project conversation')

  await evalOn(live, `window.electronAPI.switchWorkspace('__storyflow_free__')`)
  await evalOn(live, `(() => { const url = new URL(location.href); url.search = '?workspaceId=__storyflow_free__&ws=__storyflow_free__&route=allSessions'; location.href = url.href })()`)
  await pause(1500)
  await waitForComposer(live)
  const freeSessions = await evalOn<any[]>(live, `window.electronAPI.getSessions()`)
  assert.equal(freeSessions.length, 1)
  assert.equal(freeSessions[0].messages.length, 0)
  const freeRoute = await evalOn<string>(live, `new URL(location.href).searchParams.get('route')`)
  await live.close()
  live = undefined
  live = await launchApp(fixture, { preserveServerLockState: true, userDataDir: join(fixture, 'electron-profile') })
  await waitForComposer(live)
  assert.equal(await evalOn(live, `new URL(location.href).searchParams.get('route')`), freeRoute)
  assert.equal((await evalOn<any[]>(live, `window.electronAPI.getSessions()`)).length, 1)
  console.log('PASS: empty free workspace opens one composer and survives restart without duplicates')

  await evalOn(live, `window.electronAPI.sessionCommand(${JSON.stringify(freeSessions[0].id)}, {type:'setPermissionMode', mode:'allow-all', remember:true})`)
  const projectRoot = join(fixture, 'empty-project')
  mkdirSync(projectRoot)
  const project = await evalOn<{id: string}>(live, `window.electronAPI.createWorkspace(${JSON.stringify(projectRoot)}, 'Empty startup project')`)
  await evalOn(live, `window.electronAPI.switchWorkspace(${JSON.stringify(project.id)})`)
  await evalOn(live, `(() => { const url = new URL(location.href); url.search = new URLSearchParams({workspaceId:${JSON.stringify(project.id)},ws:${JSON.stringify(project.id)},route:'writing'}).toString(); location.href = url.href })()`)
  await pause(1500)
  await waitForComposer(live)
  const projectSessions = await evalOn<any[]>(live, `window.electronAPI.getSessions()`)
  assert.equal(projectSessions.length, 1)
  assert.equal(projectSessions[0].messages.length, 0)
  assert.equal(projectSessions[0].permissionMode, 'allow-all')
  await openRoute(live, 'writing')
  assert.equal((await evalOn<any[]>(live, `window.electronAPI.getSessions()`)).length, 1)
  console.log('PASS: empty project opens one blank conversation in the remembered mode')

  const externalRoot = join(fixture, 'external-project')
  mkdirSync(externalRoot)
  const external = await evalOn<{id: string}>(live, `window.electronAPI.createWorkspace(${JSON.stringify(externalRoot)}, 'External startup project')`)
  const preferences = join(fixture, 'session-permission-modes.json')
  const beforeDeepLink = readFileSync(preferences, 'utf8')
  await live.close()
  live = await launchApp(fixture, {
    preserveServerLockState: true,
    userDataDir: join(fixture, 'electron-profile'),
    deepLink: `craftagents://workspace/${external.id}/allSessions`,
  })
  await waitFor(live, `new URL(location.href).searchParams.get('workspaceId') === ${JSON.stringify(external.id)}`)
  await waitForComposer(live)
  const externalSessions = await evalOn<Array<{workspaceId: string; permissionMode: string}>>(live, `window.electronAPI.getSessions()`)
  assert.equal(externalSessions.length, 1)
  assert.equal(externalSessions[0].workspaceId, external.id)
  assert.equal(externalSessions[0].permissionMode, 'ask')
  assert.equal(readFileSync(preferences, 'utf8'), beforeDeepLink)
  console.log('PASS: opening an empty project by deep link uses the project default without changing grants')

  const restoredProjects: Array<{ id: string }> = []
  for (const name of ['Untargeted restore', 'Targeted restore']) {
    const folder = join(fixture, name)
    mkdirSync(folder)
    restoredProjects.push(await evalOn<{id: string}>(live, `window.electronAPI.createWorkspace(${JSON.stringify(folder)}, ${JSON.stringify(name)})`))
  }
  const [untargeted, targeted] = restoredProjects
  assert.ok(untargeted && targeted)
  await live.close()
  const windowStatePath = join(fixture, 'window-state.json')
  const { bounds } = JSON.parse(readFileSync(windowStatePath, 'utf8')).windows[0]
  writeFileSync(windowStatePath, JSON.stringify({
    windows: restoredProjects.map(({ id }) => ({ type: 'main', workspaceId: id, bounds })),
    lastFocusedWorkspaceId: untargeted.id,
  }))
  live = await launchApp(fixture, {
    userDataDir: join(fixture, 'electron-profile'),
    deepLink: `craftagents://workspace/${targeted.id}/allSessions`,
  })
  await waitForComposer(live)
  const deadline = Date.now() + 15_000
  let restoredModes: string[][] = []
  while (Date.now() < deadline) {
    restoredModes = await evalOn<string[][]>(live, `Promise.all(${JSON.stringify(restoredProjects.map(({ id }) => id))}.map(async id =>
      (await window.electronAPI.listSessionsByWorkspace(id)).map(session => session.permissionMode)
    ))`)
    if (restoredModes.every(modes => modes.length > 0)) break
    await pause(150)
  }
  assert.deepEqual(restoredModes, [['allow-all'], ['ask']])
  console.log('PASS: cold deep link applies only to the targeted project among restored windows')
} finally {
  await live?.close()
  rmSync(fixture, { recursive: true, force: true })
}
