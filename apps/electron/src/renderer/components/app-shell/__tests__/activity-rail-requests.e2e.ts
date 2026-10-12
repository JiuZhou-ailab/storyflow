import { expect, test } from 'bun:test'
import { createServer } from 'vite'
import { resolve, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { launchApp, evalOn, waitFor, sleep } from '../../../../../../../e2e/perf/launch'

// Run after bun run electron:build: bun test ./apps/electron/src/renderer/components/app-shell/__tests__/activity-rail-requests.e2e.ts
// Real React effects and DOM; only the public Electron API is replaced in the iframe.
test('ActivityRail avoids display-only refetches while retaining scoped pins and invalidation', async () => {
  const root = resolve(import.meta.dirname, '../../../../../../..')
  const cache = mkdtempSync(join(tmpdir(), 'rail-vite-'))
  const fixture = mkdtempSync(join(tmpdir(), 'rail-fixture-'))
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { cwd: root, stdio: 'pipe' })
  const probe = join(import.meta.dirname, 'activity-rail-requests.probe.tsx')
  const vite = await createServer({
    configFile: join(root, 'apps/electron/vite.config.ts'), cacheDir: cache,
    optimizeDeps: { entries: [probe] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [{ name: 'rail-regression', configureServer(server) {
      server.middlewares.use('/rail-probe-frame', async (_req, res) => {
        res.setHeader('content-type', 'text/html')
        res.end(await server.transformIndexHtml('/rail-probe-frame', `<html><body><div id="root"></div><script type="module" src="/@fs/${probe}"></script></body></html>`))
      })
      server.middlewares.use('/rail-probe', (_req, res) => {
        res.setHeader('content-type', 'text/html')
        res.end('<html><body><script>addEventListener("message",e=>{if(e.data.railProbe)window.__railProbe=e.data.railProbe})</script><iframe src="/rail-probe-frame"></iframe></body></html>')
      })
    } }],
  })
  let app: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    await vite.listen()
    app = await launchApp(fixture)
    const address = vite.httpServer!.address() as { port: number }
    await app.cdp.send('Page.navigate', { url: `http://127.0.0.1:${address.port}/rail-probe` }, app.sid)
    await waitFor(app, '!!window.__railProbe', 60000, 'ActivityRail React probe')
    const result = await evalOn(app, 'window.__railProbe')
    expect(result.error).toBeUndefined()
    expect(result.result?.pinnedVisible).toBe(true)
  } finally {
    await app?.close()
    await Promise.race([vite.close(), sleep(2000)])
    rmSync(cache, { recursive: true, force: true })
    rmSync(fixture, { recursive: true, force: true })
  }
}, 90000)
