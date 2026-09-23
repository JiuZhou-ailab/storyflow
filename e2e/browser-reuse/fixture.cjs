// input: An isolated profile path and dependency directory supplied by run.mjs
// output: Two same-URL WebContentsViews, an application shell, and independent DOM observations
// pos: Offline Electron fixture for the browser-reuse gate; never loads Storyflow user data
const { app, BrowserWindow, WebContentsView } = require('electron')
const { createServer } = require('node:http')
const { createRequire } = require('node:module')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

app.setPath('userData', process.env.STORYFLOW_PROOF_PROFILE)
const views = []
let window
let server

async function main() {
  await app.whenReady()
  server = createServer((request, response) => {
    if (request.url !== '/page') { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<title>Shared URL</title><label>Name<input></label><button onclick="this.textContent=\'Done\'">Save</button>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/page`
  window = new BrowserWindow({ width: 1000, height: 650, show: false, webPreferences: { sandbox: true } })
  await window.loadURL('data:text/html,<title>Private application shell</title><p id="secret">shell-only</p>')
  for (const [index, partition] of ['persist:session-a', 'persist:session-b'].entries()) {
    const view = new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    window.contentView.addChildView(view)
    view.setBounds({ x: index * 500, y: 0, width: 500, height: 600 })
    await view.webContents.loadURL(url)
    await view.webContents.executeJavaScript(`document.title = ${JSON.stringify(index === 0 ? 'Session A' : 'Session B')}`)
    views.push(view)
  }
  window.showInactive()
  console.log('STORYFLOW_PROOF_READY ' + JSON.stringify({ url, electron: process.versions.electron, chromium: process.versions.chrome }))

  // Test-only IPC: the parent observes the actual fixture, independently of the candidate library.
  process.on('message', async ({ id, command }) => {
    try {
      if (command === 'read') {
        const values = await Promise.all(views.map(view => view.webContents.executeJavaScript('document.querySelector("input").value')))
        process.send({ id, result: values })
      } else if (command === 'debugger-connect') {
        process.send({ id, result: await connectViaDebugger(views[0].webContents) })
      } else if (command === 'quit') {
        app.quit()
      } else {
        throw new Error('Unknown fixture command')
      }
    } catch (error) { process.send({ id, error: String(error) }) }
  })
}

async function connectViaDebugger(webContents) {
  const dependencyRequire = createRequire(join(process.env.STORYFLOW_PROOF_DEPS, 'package.json'))
  const { default: puppeteer } = await import(pathToFileURL(dependencyRequire.resolve('puppeteer-core')).href)
  webContents.debugger.attach('1.3')
  const methods = []
  // A transparent use of Puppeteer's public ConnectionTransport, without emulating browser commands.
  const transport = {
    send(raw) {
      const { id, method, params, sessionId } = JSON.parse(raw)
      methods.push(method)
      webContents.debugger.sendCommand(method, params, sessionId).then(
        result => transport.onmessage?.(JSON.stringify({ id, result, sessionId })),
        error => transport.onmessage?.(JSON.stringify({ id, error: { code: -32000, message: String(error) }, sessionId })),
      )
    },
    close() { transport.onclose?.() },
  }
  const onMessage = (_, method, params, sessionId) => transport.onmessage?.(JSON.stringify({ method, params, sessionId }))
  webContents.debugger.on('message', onMessage)
  let browser
  try {
    browser = await puppeteer.connect({ transport, defaultViewport: null, protocolTimeout: 5000 })
    return { connected: true, methods }
  } catch (error) {
    return { connected: false, error: String(error), methods }
  } finally {
    if (browser) await browser.disconnect()
    webContents.debugger.removeListener('message', onMessage)
    if (webContents.debugger.isAttached()) webContents.debugger.detach()
  }
}

app.on('will-quit', () => { server?.close(); views.forEach(view => { if (!view.webContents.isDestroyed()) view.webContents.close() }) })
main().catch(error => { console.error(error); app.exit(1) })
