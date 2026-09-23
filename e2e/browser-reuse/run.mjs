// input: Repository Electron executable and isolated, pinned candidate dependencies
// output: Independent same-page evidence and a nonzero exit until the production isolation gate passes
// pos: Pre-migration integration probe for #55, separate from the existing performance harness
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../..')
assert.ok(process.env.STORYFLOW_PROOF_DEPS, 'Set STORYFLOW_PROOF_DEPS to the isolated dependency directory described in README.md')
const dependencyDirectory = resolve(process.env.STORYFLOW_PROOF_DEPS)
const dependencyRequire = createRequire(join(dependencyDirectory, 'package.json'))
const load = name => import(pathToFileURL(dependencyRequire.resolve(name)).href)
const binary = process.env.CRAFT_E2E_ELECTRON_BIN ?? join(root, 'node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron')
const profile = await mkdtemp(join(tmpdir(), 'storyflow-browser-reuse-'))
const pending = new Map()
let requestId = 0
let client, mcpServer, playwrightBrowser, puppeteerBrowser
const report = { versions: {}, checks: [], limitations: ['Tests these public connection paths only, not every possible integration.', 'No production Storyflow tool route, full accuracy matrix or packaged Windows acceptance exercised.'] }
const child = spawn(binary, [join(directory, 'fixture.cjs'), '--remote-debugging-port=0'], {
  env: { ...process.env, STORYFLOW_PROOF_PROFILE: profile, STORYFLOW_PROOF_DEPS: dependencyDirectory, ELECTRON_RUN_AS_NODE: '' },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
const exited = new Promise(resolveExit => child.once('close', resolveExit))
const call = command => new Promise((resolveCall, reject) => {
  const id = ++requestId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture timeout: ${command}`)) }, 15000)
  pending.set(id, { resolve: value => { clearTimeout(timer); resolveCall(value) }, reject: error => { clearTimeout(timer); reject(error) } })
  child.send({ id, command })
})
child.on('message', message => {
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  message.error ? request.reject(new Error(message.error)) : request.resolve(message.result)
})

try {
  const { endpoint, fixture } = await new Promise((resolveReady, reject) => {
    let stdout = '', stderr = '', endpoint, fixture
    const timer = setTimeout(() => reject(new Error(`Electron startup timeout: ${stderr.slice(-1000)}`)), 20000)
    const ready = () => { if (endpoint && fixture) { clearTimeout(timer); resolveReady({ endpoint, fixture }) } }
    child.stdout.on('data', data => { stdout += data; const match = stdout.match(/STORYFLOW_PROOF_READY (.+)\n/); if (match) fixture = JSON.parse(match[1]); ready() })
    child.stderr.on('data', data => { stderr += data; endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]; ready() })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Electron exited during startup: ${code}`)) })
  })
  report.versions.electron = fixture.electron
  report.versions.chromium = fixture.chromium
  report.versions.playwright = dependencyRequire('playwright-core/package.json').version
  report.versions.puppeteer = dependencyRequire('puppeteer-core/package.json').version
  report.versions.mcp = dependencyRequire('@playwright/mcp/package.json').version

  const { chromium } = await load('playwright-core')
  playwrightBrowser = await chromium.connectOverCDP(endpoint, { timeout: 5000 })
  const contexts = playwrightBrowser.contexts()
  const pages = await Promise.all(contexts.map(async context => Promise.all(context.pages().map(async page => ({ title: await page.title(), page })))))
  const ownedContextIndex = pages.findIndex(entries => entries.some(entry => entry.title === 'Session A'))
  assert.ok(ownedContextIndex >= 0, 'Fixture Session A must be discoverable')
  const ownedContext = contexts[ownedContextIndex]
  const ownPage = pages[ownedContextIndex].find(entry => entry.title === 'Session A').page
  await ownPage.getByRole('textbox', { name: 'Name' }).fill('Playwright writes A')
  assert.deepEqual(await call('read'), ['Playwright writes A', ''])
  report.checks.push({ name: 'Playwright page selection modifies the real A page only', passed: true })

  const { createConnection } = await load('@playwright/mcp')
  const { Client } = await load('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await load('@modelcontextprotocol/sdk/inMemory.js')
  mcpServer = await createConnection({}, async () => ownedContext)
  client = new Client({ name: 'storyflow-browser-reuse-gate', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcpServer.connect(serverTransport)
  await client.connect(clientTransport)
  const tabs = await client.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })
  assert.ok(!tabs.isError, 'MCP tab list must work before assessing isolation')
  const list = tabs.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  report.checks.push({ name: 'MCP public contextGetter limits tools to Session A', passed: !list.includes('Session B') && !list.includes('Private application shell'), observed: list })
  const otherTab = list.match(/- (\d+):[^\n]*\[Session B\]/)?.[1]
  if (otherTab) {
    const selected = await client.callTool({ name: 'browser_tabs', arguments: { action: 'select', index: Number(otherTab) } })
    assert.ok(!selected.isError, 'MCP selection must work before assessing cross-session access')
    const write = await client.callTool({ name: 'browser_evaluate', arguments: { function: "() => { document.querySelector('input').value = 'cross-session write' }" } })
    const observed = await call('read')
    report.checks.push({ name: 'MCP refuses modification of Session B', passed: observed[1] === '', observed, toolReportedError: Boolean(write.isError) })
  }
  report.checks.push({ name: 'Electron partitions are distinct Playwright contexts', passed: pages.every(entries => !entries.some(x => x.title === 'Session A') || !entries.some(x => x.title === 'Session B')), observed: pages.map(entries => entries.map(x => x.title)) })
  await client.close(); client = undefined
  await mcpServer.close(); mcpServer = undefined
  // MCP shutdown can close its supplied context; reconnect only if the fixture remains alive.
  await playwrightBrowser.close(); playwrightBrowser = undefined

  const { default: puppeteer } = await load('puppeteer-core')
  puppeteerBrowser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 5000 })
  const candidatePages = await puppeteerBrowser.pages()
  const titles = await Promise.all(candidatePages.map(page => page.title()))
  const pageA = candidatePages[titles.indexOf('Session A')]
  assert.ok(pageA, 'Puppeteer must discover Session A')
  const beforePuppeteer = await call('read')
  await pageA.locator('input').fill('Puppeteer writes A')
  assert.deepEqual(await call('read'), ['Puppeteer writes A', beforePuppeteer[1]])
  report.checks.push({ name: 'Puppeteer page selection modifies the real A page only', passed: true })
  await puppeteerBrowser.disconnect(); puppeteerBrowser = undefined

  const discovery = await fetch(endpoint.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '/json/list'))
  const unauthenticatedTargets = discovery.ok ? await discovery.json() : []
  report.checks.push({ name: 'Browser-level endpoint denies unauthenticated global discovery', passed: discovery.status === 401 || discovery.status === 403, status: discovery.status, observed: unauthenticatedTargets.map(target => target.title) })
  const debuggerConnection = await call('debugger-connect')
  report.checks.push({ name: 'Public Puppeteer connect works with transparent page debugger transport', passed: debuggerConnection.connected, observed: debuggerConnection })
} catch (error) {
  report.error = String(error)
} finally {
  await Promise.allSettled([client?.close(), mcpServer?.close(), playwrightBrowser?.close(), puppeteerBrowser?.disconnect()])
  if (child.connected) child.send({ command: 'quit' })
  const kill = setTimeout(() => child.kill('SIGKILL'), 3000)
  await exited
  clearTimeout(kill)
  for (const request of pending.values()) request.reject(new Error('Fixture closed'))
  await rm(profile, { recursive: true, force: true })
}

// Each path has its own prerequisites; alternative transport probes need not all pass.
const passed = name => report.checks.find(check => check.name === name)?.passed === true
report.browserEndpointAuthenticated = passed('Browser-level endpoint denies unauthenticated global discovery')
report.candidatePaths = {
  mcpContextGetter: report.browserEndpointAuthenticated && passed('MCP public contextGetter limits tools to Session A'),
  playwrightPage: report.browserEndpointAuthenticated && passed('Playwright page selection modifies the real A page only'),
  puppeteerPage: report.browserEndpointAuthenticated && passed('Puppeteer page selection modifies the real A page only'),
}
report.passed = !report.error && Object.values(report.candidatePaths).some(Boolean)
const output = JSON.stringify(report, null, 2) + '\n'
if (process.env.STORYFLOW_PROOF_REPORT) await writeFile(process.env.STORYFLOW_PROOF_REPORT, output)
process.stdout.write(output)
process.exitCode = report.passed ? 0 : 1
