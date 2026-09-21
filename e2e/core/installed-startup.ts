// input: userData of a Windows app started by its actual installed shortcut
// output: An observable RPC-ready, visible application page (not just a process/window handle)
// pos: Post-install acceptance adapter for the existing CDP seam
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CdpClient, evaluate } from '../perf/cdp'
const profile = process.argv[2]
if (!profile) throw new Error('Expected installed-app userData directory')
const deadline = Date.now() + 60_000
let lastError: unknown
while (true) {
  if (Date.now() >= deadline) throw lastError ?? new Error('Application did not become ready')
  let cdp: CdpClient | undefined
  try {
    const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/)
    cdp = await CdpClient.connect(`ws://127.0.0.1:${port}${path}`)
    const targets = await cdp.send('Target.getTargets')
    const page = targets.targetInfos.find((target: { type: string; url: string }) => target.type === 'page' && target.url.startsWith('file:'))
    if (!page) throw new Error('No application page')
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
    const result = await evaluate(cdp, sessionId, `(async () => {
      if (document.visibilityState !== 'visible' || !window.electronAPI) throw new Error('Application page is not usable');
      return { workspaces: (await window.electronAPI.getWorkspaces()).map(w => w.id), visible: true };
    })()`)
    console.log(JSON.stringify(result))
    if (process.argv.includes('--quit')) {
      await evaluate(cdp, sessionId, 'setTimeout(() => window.electronAPI.menuQuit(), 100); true')
    }
    process.exitCode = 0
    cdp.close()
    break
  } catch (error) { lastError = error }
  finally { cdp?.close() }
  if (Date.now() + 500 >= deadline) throw lastError
  await Bun.sleep(500)
}
