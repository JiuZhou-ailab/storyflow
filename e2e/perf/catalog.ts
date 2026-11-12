// input: Standard fixture and built Electron; PERF_CATALOG_RUNS controls local sampling
// output: Application click-to-directory samples, legacy wall times, and existing filesystem spans
// pos: Real Electron catalog acceptance alongside the existing performance driver
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync, readFileSync, statSync, renameSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { launchApp, evalOn, waitFor, heapUsed, DEFAULT_FIXTURE, verifyStandardFixture } from './launch'
import { enterFirstWritingWorkspace, openWritingChapter, navigateToWritingWorkspace } from './run'
import { parsePositiveInteger, percentile } from './contract'

const runs = parsePositiveInteger(process.env.PERF_CATALOG_RUNS, 20, 'PERF_CATALOG_RUNS')
const fixture = process.env.PERF_FIXTURE ?? DEFAULT_FIXTURE
const gate = process.env.PERF_CATALOG_GATE ?? 'all'
assert.ok(gate === 'all' || gate === 'warm', 'PERF_CATALOG_GATE must be all or warm')
const root = resolve(import.meta.dirname, '../..')
const resultsDir = process.env.PERF_RESULTS_DIR ?? join(import.meta.dirname, 'results')
mkdirSync(resultsDir, { recursive: true })
const renderer = process.env.VITE_DEV_SERVER_URL ? fileURLToPath(process.env.VITE_DEV_SERVER_URL) : join(root, 'apps/electron/dist/renderer/index.html')
const report: { cold: unknown[]; warm: unknown[]; failure?: string; [key: string]: unknown } = {
  cold: [], warm: [], gate, baseline: process.env.PERF_BASELINE === '1', at: new Date().toISOString(), fixture,
  instrumentation: { rpcTrace: process.env.PERF_CATALOG_TRACE === '1', cpuProfile: process.env.PERF_CATALOG_PROFILE === '1' },
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  buildSha256: Object.fromEntries([join(root, 'apps/electron/dist/main.cjs'), renderer].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
}
const install = `(() => {
  window.__catalogTiming = { timeOrigin: performance.timeOrigin, project: null, session: null, route: null, ready: null };
  const timing = window.__catalogTiming;
  const click = e => {
    if (e.target.closest('button[aria-label^="项目："],button[aria-label^="Project:"]')) timing.project = performance.now();
    if (e.target.closest('[data-session-id] button')) timing.session = performance.now();
  };
  const route = () => { timing.route = performance.now() };
  document.addEventListener('click', click, true);
  window.addEventListener('craft-agent-navigate', route);
  const observer = new MutationObserver(() => {
    if (timing.ready !== null || timing.session === null) return;
    const row = [...document.querySelectorAll('[data-panel-role="directory"] [role="treeitem"]')].find(el => el.firstElementChild?.title === '正文');
    if (row && row.getBoundingClientRect().height > 0) {
      timing.ready = performance.now(); observer.disconnect();
    }
  });
  observer.observe(document.body, {subtree:true,childList:true,attributes:true});
  window.__stopCatalogTiming = () => {observer.disconnect();document.removeEventListener('click',click,true);window.removeEventListener('craft-agent-navigate',route)};
})()`
try {
  const openProject = async (live: Awaited<ReturnType<typeof launchApp>>, writing: boolean) => {
    await evalOn(live, `(() => {
      const button = [...document.querySelectorAll('button[aria-label^="项目："],button[aria-label^="Project:"]')].find(b => (b.title === '400章长篇小说') === ${writing});
      if (!button) throw new Error('Missing fixture project');
      window.__catalogProjectRoot = button.parentElement.parentElement;
      if (button.getAttribute('aria-expanded') !== 'true') button.click();
    })()`)
    await waitFor(live, '!!window.__catalogProjectRoot.querySelector("[data-session-id] button")', 30000, 'target project session')
    await evalOn(live, 'window.__catalogProjectRoot.querySelector("[data-session-id] button").click()')
  }
  for (let i = 0; i < runs; i++) {
    const live = await launchApp(fixture)
    try {
      await waitFor(live, '!!window.electronAPI', 30000, 'preload')
      await evalOn(live, install)
      const rpcTrace: Array<{ id: string; channel?: string; type: string; at: number; bytes: number; imagePath?: string }> = []
      const frameMethods = ['Network.webSocketFrameSent', 'Network.webSocketFrameReceived']
      const captureRpc = (frame: any) => {
        if (frame.response.opcode !== 1) return
        const message = JSON.parse(frame.response.payloadData)
        rpcTrace.push({
          id: message.id, channel: message.channel, type: message.type,
          at: frame.timestamp, bytes: Buffer.byteLength(frame.response.payloadData, 'utf8'),
          // Record only image paths for duplicate-probe diagnosis, never general RPC payloads.
          ...(message.channel === 'workspace:readImage' ? { imagePath: message.args?.[1] } : {}),
        })
      }
      if (process.env.PERF_CATALOG_TRACE === '1') {
        for (const method of frameMethods) live.cdp.on(method, captureRpc)
        await live.cdp.send('Network.enable', {}, live.sid)
      }
      if (process.env.PERF_CATALOG_PROFILE === '1') { await live.cdp.send('Profiler.enable', {}, live.sid); await live.cdp.send('Profiler.start', {}, live.sid) }
      const legacy = await enterFirstWritingWorkspace(live)
      await waitFor(live, 'window.__catalogTiming.ready !== null', 10000, 'real catalog rows')
      report.cold.push({ ...await evalOn(live, 'window.__catalogTiming'), rpcTrace: [...rpcTrace], legacyWallMs: legacy.catalogReadyAt - legacy.projectClickedAt, startupMarks: legacy.startupMarks, spans: live.perfLines.map(line => line.text).filter(line => /listFiles|switchWorkspace|getSessions/.test(line)) })
      if (process.env.PERF_CATALOG_TRACE === '1') {
        for (const method of frameMethods) live.cdp.off(method, captureRpc)
        await live.cdp.send('Network.disable', {}, live.sid)
      }
      if (process.env.PERF_CATALOG_PROFILE === '1') writeFileSync(join(resultsDir, 'catalog-profile.json'), JSON.stringify(await live.cdp.send('Profiler.stop', {}, live.sid)))
      await evalOn(live, 'window.__stopCatalogTiming()')
      console.log('cold sample', JSON.stringify(report.cold.at(-1)))
      if (i === 0) {
        await verifyStandardFixture(live, fixture)
        report.fixtureVerified = true
        report.heapAfterColdMb = await heapUsed(live) / 1e6
        for (let j = 0; j < 30; j++) {
          await openProject(live, false)
          await waitFor(live, `![...document.querySelectorAll('[data-panel-role="directory"] [role="treeitem"]')].some(el => el.firstElementChild?.title === '正文')`, 10000, 'previous catalog left')
          rpcTrace.length = 0
          if (process.env.PERF_CATALOG_TRACE === '1') {
            for (const method of frameMethods) live.cdp.on(method, captureRpc)
            await live.cdp.send('Network.enable', {}, live.sid)
          }
          await evalOn(live, install)
          await openProject(live, true)
          await navigateToWritingWorkspace(live)
          await waitFor(live, 'window.__catalogTiming.ready !== null', 10000, 'warm catalog rows')
          report.warm.push({ ...await evalOn(live, 'window.__catalogTiming'), rpcTrace: [...rpcTrace] })
          if (process.env.PERF_CATALOG_TRACE === '1') {
            for (const method of frameMethods) live.cdp.off(method, captureRpc)
            await live.cdp.send('Network.disable', {}, live.sid)
          }
          await evalOn(live, 'window.__stopCatalogTiming()')
          console.log('warm sample', j + 1)
        }
      }
      if (i === 0 && process.env.PERF_CATALOG_RECOVERY === '1') {
        const config = JSON.parse(readFileSync(join(fixture, 'config.json'), 'utf8'))
        const workspaceRoot = config.workspaces.find((w: { name: string }) => w.name === '400章长篇小说').rootPath.replace(/^~(?=\/|$)/, fixture)
        const first = join(workspaceRoot, '__catalog-qa-added.md')
        const renamed = join(workspaceRoot, '__catalog-qa-renamed.md')
        const row = (name: string) => `[...document.querySelectorAll('[data-panel-role="directory"] [role="treeitem"]')].some(el => el.firstElementChild?.title === ${JSON.stringify(name)})`
        try {
          await openProject(live, false)
          await waitFor(live, `!${row('正文')}`, 10000, 'left writing Project for external changes')
          writeFileSync(first, 'catalog QA')
          await openProject(live, true)
          await waitFor(live, row('__catalog-qa-added.md'), 10000, 'external addition on warm return')
          renameSync(first, renamed)
          await evalOn(live, 'window.dispatchEvent(new Event("focus"))')
          await waitFor(live, `${row('__catalog-qa-renamed.md')} && !${row('__catalog-qa-added.md')}`, 10000, 'external rename')
          rmSync(renamed)
          await evalOn(live, 'window.dispatchEvent(new Event("focus"))')
          await waitFor(live, `!${row('__catalog-qa-renamed.md')}`, 10000, 'external deletion')
          report.fileChanges = { additionWhileAway: true, rename: true, deletion: true }
        } finally { rmSync(first, { force: true }); rmSync(renamed, { force: true }) }
      }
      if (i === 0 && process.env.PERF_CATALOG_RECOVERY === '1') {
        await navigateToWritingWorkspace(live)
        await openWritingChapter(live, 1)
        const config = JSON.parse(readFileSync(join(fixture, 'config.json'), 'utf8'))
        const workspaceRoot = config.workspaces.find((w: { name: string }) => w.name === '400章长篇小说').rootPath
        const directory = join(workspaceRoot.replace(/^~(?=\/|$)/, fixture), '正文')
        const mode = statSync(directory).mode & 0o777
        const unsavedMarker = `UNSAVED_CATALOG_GUARD_${Date.now()}`
        try {
          await evalOn(live, `(() => {
            const editor = document.querySelector('[data-testid="text-document"] .tiptap-editor--manuscript .ProseMirror, textarea[data-testid="text-source"]');
            window.__catalogEditor = editor; editor.focus();
            if (editor instanceof HTMLTextAreaElement) editor.setSelectionRange(editor.value.length, editor.value.length);
            else {
              const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
              getSelection().removeAllRanges(); getSelection().addRange(range);
            }
            const panel = document.querySelector('[data-panel-role="directory"]');
            window.__catalogTree = panel.querySelector('[role="tree"]');
            window.__catalogExpanded = [...panel.querySelectorAll('[role="treeitem"][aria-expanded="true"]')].map(el => el.firstElementChild?.title);
            window.__catalogScroller = [...panel.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY));
            if (window.__catalogScroller) window.__catalogScroller.scrollTop = 300;
            window.__catalogScrollTop = window.__catalogScroller?.scrollTop;
          })()`)
          chmodSync(directory, 0)
          await live.cdp.send('Input.insertText', { text: ` ${unsavedMarker}` }, live.sid)
          await evalOn(live, 'window.dispatchEvent(new Event("focus"))')
          const retry = `[...document.querySelectorAll('[role="alert"] button')].find(b => /重试|Retry/.test(b.textContent))`
          await waitFor(live, `!!(${retry})`, 5000, 'catalog read error')
          await evalOn(live, `(${retry}).click()`)
          await waitFor(live, `!!(${retry})`, 5000, 'repeated catalog read error')
          assert.ok(await evalOn(live, `document.querySelector('[data-testid="text-document"] .tiptap-editor--manuscript .ProseMirror, textarea[data-testid="text-source"]') === window.__catalogEditor && (window.__catalogEditor.value ?? window.__catalogEditor.textContent).includes(${JSON.stringify(unsavedMarker)})`), 'Failed catalog retry must preserve the mounted dirty editor')
          chmodSync(directory, mode)
          await evalOn(live, `(${retry}).click()`)
          await waitFor(live, `!(${retry})`, 5000, 'catalog retry success')
          assert.ok(await evalOn(live, `document.querySelector('[data-testid="text-document"] .tiptap-editor--manuscript .ProseMirror, textarea[data-testid="text-source"]') === window.__catalogEditor && (window.__catalogEditor.value ?? window.__catalogEditor.textContent).includes(${JSON.stringify(unsavedMarker)})`))
          assert.ok(await evalOn(live, `(() => {
            const panel = document.querySelector('[data-panel-role="directory"]');
            return panel.querySelector('[role="tree"]') === window.__catalogTree
              && JSON.stringify([...panel.querySelectorAll('[role="treeitem"][aria-expanded="true"]')].map(el => el.firstElementChild?.title)) === JSON.stringify(window.__catalogExpanded)
              && (!window.__catalogScroller || Math.abs(window.__catalogScroller.scrollTop - window.__catalogScrollTop) <= 30);
          })()`), 'Catalog refresh must preserve the directory tree, expansion and scroll position')
          report.recovery = { repeatedFailurePreservedEditor: true, retryRecovered: true, treeExpansionAndScrollPreserved: true }
        } finally { chmodSync(directory, mode) }
      }
      if (i === 0 && process.env.PERF_CATALOG_RECOVERY === '1') {
        // Freeze session IDs: launchApp follows the newest page for ordinary drivers.
        const primary = { ...live, sid: live.sid }
        const config = JSON.parse(readFileSync(join(fixture, 'config.json'), 'utf8'))
        const project = config.workspaces.find((w: { name: string }) => w.name === '400章长篇小说')
        const workspaceRoot = project.rootPath.replace(/^~(?=\/|$)/, fixture)
        const marker = join(workspaceRoot, '__catalog-window-qa.md')
        const sessions = await evalOn<Array<{ id: string }>>(primary, `window.electronAPI.listSessionsByWorkspace(${JSON.stringify(project.id)})`)
        await evalOn(primary, `window.electronAPI.openSessionInNewWindow(${JSON.stringify(project.id)}, ${JSON.stringify(sessions[0].id)})`)
        const targets = await live.cdp.send('Target.getTargets')
        const pages = targets.targetInfos.filter((t: any) => t.type === 'page')
        assert.equal(pages.length, 2, 'Expected two real Project windows')
        const second = { ...live, sid: live.sid }
        assert.notEqual(primary.sid, second.sid)
        try {
          await waitFor(second, `!!document.querySelector('[data-panel-role="directory"] [role="treeitem"]')`, 30000, 'second window catalog')
          await evalOn(second, `window.electronAPI.writeFile(${JSON.stringify(marker)}, 'second window change')`)
          await evalOn(primary, 'window.dispatchEvent(new Event("focus"))')
          await waitFor(primary, `[...document.querySelectorAll('[data-panel-role="directory"] [role="treeitem"]')].some(el => el.firstElementChild?.title === '__catalog-window-qa.md')`, 10000, 'other window change reflected')
          report.multiWindow = { realWindows: 2, otherWindowWriteRefreshed: true }
        } finally { rmSync(marker, { force: true }) }
      }
      console.log('catalog', i + 1, JSON.stringify(report.cold.at(-1)))
    } catch (error) {
      report.failureUi = await evalOn(live, 'document.body.innerText').catch(() => null)
      report.failureLogs = live.processLines.slice(-30)
      throw error
    } finally { await live.close() }
  }
  const budgets: Record<string, unknown> = {}
  report.budgets = budgets
  for (const [kind, samples] of Object.entries(report)) {
    if (!Array.isArray(samples)) continue
    const ms = samples.map((s: any) => s.ready - s.session).sort((a,b) => a-b)
    assert.ok(ms.length > 0 && ms.every(Number.isFinite), 'Missing catalog samples')
    budgets[kind] = {n:ms.length,p50:percentile(ms,.5),p95:percentile(ms,.95),max:ms.at(-1),pass:percentile(ms,.5)<=100 && percentile(ms,.95)<=500}
    console.log(kind, JSON.stringify(budgets[kind]))

  }
  if (process.env.PERF_BASELINE !== '1') assert.ok((gate === 'warm' ? [(budgets as any).warm] : Object.values(budgets)).every((value: any) => value.pass), 'Catalog performance budget')
} catch (error) { report.failure = String(error); process.exitCode = 1; console.error(error) }
finally {
  mkdirSync(resultsDir, { recursive:true })
  const output = join(resultsDir, `catalog-${Date.now()}.json`)
  writeFileSync(output, JSON.stringify(report,null,2)); console.log('Evidence:',output)
}
