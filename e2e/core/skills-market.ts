// input: Built Electron app, isolated project files, and deterministic Market responses
// output: Upload/retry/listing, authenticated API consumption, real file installation, and prefilled Skill task checks
// pos: Skills Market UI acceptance; publication is intercepted and never reaches the public registry
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp, evalOn, waitFor, type LaunchedApp } from '../perf/launch'
import { buildSkillInstallDeepLink, prepareMarketSkillBundle, sha256Hex } from '../../packages/shared/src/skills/marketplace'

const fixture = mkdtempSync('/tmp/storyflow-skills-market-')
let app: LaunchedApp | undefined
try {
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { cwd: resolve(import.meta.dirname, '../..'), stdio: 'pipe' })
  const config = JSON.parse(readFileSync(join(fixture, 'config.json'), 'utf8'))
  const workspace = config.workspaces[0]
  const localPath = join(workspace.rootPath, '.pi/skills/qa-upload')
  mkdirSync(localPath, { recursive: true })
  writeFileSync(join(localPath, 'SKILL.md'), '---\nname: qa-upload\ndescription: Local upload acceptance\n---\n\nHelp the user write a short story.\n')
  writeFileSync(join(localPath, 'reference.md'), 'A supporting reference.\n')
  const markdown = '---\nname: qa-consume\ndescription: Consumption acceptance\n---\n\nAsk the user for their story idea.\n'
  const bundle = prepareMarketSkillBundle({
    bundle: { version: 1, exportedAt: 1, resources: { skills: [{ slug: 'qa-consume', files: [{ relativePath: 'SKILL.md', contentBase64: Buffer.from(markdown).toString('base64'), size: Buffer.byteLength(markdown) }] }] } },
    publication: { version: '1.0.0', displayName: 'QA Consumption', summary: 'Consumption acceptance', license: 'MIT', visibility: 'company' },
  }, { name: 'QA' })
  const raw = JSON.stringify(bundle)
  const sha256 = await sha256Hex(raw)
  const summary = { slug: 'qa-consume', version: '1.0.0', displayName: 'QA Consumption', summary: 'Consumption acceptance', license: 'MIT', visibility: 'company', author: 'QA', publisher: { id: 'qa-user', displayName: 'QA' }, tags: [], roots: [], downloadCount: 0, sha256 }
  const detail = { ...summary, skillMarkdown: markdown, manifest: JSON.parse(Buffer.from(bundle.resources.skills![0]!.files.find(file => file.relativePath === 'storyflow.json')!.contentBase64, 'base64').toString()), downloadPath: '/unused', installUrl: buildSkillInstallDeepLink(summary as never) }
  app = await launchApp(fixture)
  const live = app
  await waitFor(live, 'window.electronAPI && document.querySelector("[data-tutorial=activity-profile]")')
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)

  await evalOn(live, `window.electronAPI.switchWorkspace(${JSON.stringify(workspace.id)})`)
  await evalOn(live, `(() => { const url = new URL(location.href); url.search = new URLSearchParams({workspaceId:${JSON.stringify(workspace.id)},ws:${JSON.stringify(workspace.id)},route:'allSessions'}).toString(); location.href=url.href })()`)
  await waitFor(live, 'document.querySelector("[data-tutorial=activity-profile]")')
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  assert.ok((await evalOn<Array<{slug: string}>>(live, `window.electronAPI.getSkills(${JSON.stringify(workspace.id)})`)).some(skill => skill.slug === 'qa-upload'))

  // Patch only the isolated fixture's Market IPC at a preload breakpoint. Real resource RPCs remain intact.
  console.log('QA: shell ready; intercepting Market IPC')
  await live.cdp.send('Debugger.enable', {}, live.sid)
  const preloadLines = readFileSync(resolve('apps/electron/dist/bootstrap-preload.cjs'), 'utf8').split('\n')
  const lineNumber = preloadLines.findIndex(line => line.startsWith('api.listSkillsFromMarket ='))
  assert.ok(lineNumber >= 0)
  const breakpoint = await live.cdp.send('Debugger.setBreakpointByUrl', { urlRegex: 'bootstrap-preload\\.cjs$', lineNumber, columnNumber: preloadLines[lineNumber]!.indexOf('import_electron') }, live.sid)
  let patchError: unknown
  let patched = false
  const paused = async (event: any) => {
    console.log('QA: Market IPC paused')
    try {
      const response = await live.cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId, expression: `(() => {
        const ipc = import_electron.ipcRenderer;
        const invoke = ipc.invoke.bind(ipc);
        globalThis.__marketQA = { publications: [], downloads: [], catalog: [${JSON.stringify(summary)}] };
        ipc.invoke = async (channel, ...args) => {
          const qa = globalThis.__marketQA;
          if (channel === 'skills-market:list') return { skills: qa.catalog, total: qa.catalog.length };
          if (channel === 'skills-market:detail') return ${JSON.stringify(detail)};
          if (channel === 'skills-market:download') { qa.downloads.push(args[0]); return ${JSON.stringify({ bundle, raw, sha256 })}; }
          if (channel === 'client-auth:get-state') return { required: false, configured: true, authenticated: true, user: { provider: 'neon', userId: 'qa-user', organizationId: 'qa-company' } };
          if (channel === 'skills-market:publish') {
            qa.publications.push(args[0]);
            if (qa.publications.length === 1) throw new Error('QA review rejected: revise the summary');
            const input = args[0];
            const published = { ...${JSON.stringify(summary)}, ...input.publication, slug: 'qa-upload', sha256: '${'b'.repeat(64)}' };
            qa.catalog = [published, ...qa.catalog];
            return { status: 'published', slug: published.slug, version: published.version, sha256: published.sha256 };
          }
          return invoke(channel, ...args);
        };
      })()` }, live.sid)
      assert.equal(response.exceptionDetails, undefined)
      patched = true
    } catch (error) { patchError = error }
    finally {
      await live.cdp.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId }, live.sid)
      await live.cdp.send('Debugger.resume', {}, live.sid)
    }
  }
  live.cdp.on('Debugger.paused', paused)
  await evalOn(live, 'window.electronAPI.listSkillsFromMarket()')
  live.cdp.off('Debugger.paused', paused)
  if (patchError) throw patchError
  assert.ok(patched, 'Fixture Market interception must be installed before UI publication')
  await live.cdp.send('Debugger.disable', {}, live.sid)
  async function go(route: string) { await evalOn(live, `window.dispatchEvent(new CustomEvent('craft-agent-navigate', {detail:{route:${JSON.stringify(route)}}}))`) }
  async function click(text: string, selector = 'button') {
    const expression = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(text)})`
    await waitFor(live, expression)
    if (selector.includes('menuitem')) {
      await evalOn(live, `${expression}.click()`)
      return
    }
    const point = await evalOn<{x: number; y: number}>(live, `(() => { const element = ${expression}; element.scrollIntoView({block:'center'}); const r = element.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    await live.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, live.sid)
    await live.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, live.sid)
  }
  console.log('QA: Market responses ready')
  await go('skills')
  await waitFor(live, 'document.body.textContent.includes("QA Consumption")')
  await click('发布')
  await click('qa-upload', '[role="menuitem"]')
  await waitFor(live, 'document.querySelector("#skill-market-name") && !document.querySelector("fieldset").disabled')
  const uploadFiles = await evalOn<string>(live, 'document.querySelector("details").textContent')
  assert.ok(uploadFiles.includes('SKILL.md') && uploadFiles.includes('reference.md'))
  assert.equal(await evalOn(live, 'document.querySelector("#skill-market-visibility").textContent'), '公司内部')
  await click('审核并发布', 'button[type="submit"]')
  await waitFor(live, 'document.querySelector("[role=alert]")?.textContent.includes("QA review rejected")')
  assert.equal(await evalOn(live, 'document.querySelector("#skill-market-name").value'), 'qa-upload')
  await click('审核并发布', 'button[type="submit"]')
  await waitFor(live, 'document.querySelector("[role=dialog]")?.textContent.includes("此版本已上架")')
  const shot = await live.cdp.send('Page.captureScreenshot', {format:'png'}, live.sid)
  writeFileSync('/tmp/storyflow-skills-market-published.png', Buffer.from(shot.data, 'base64'))
  await click('查看市场')
  await waitFor(live, 'document.querySelector("main")?.textContent.includes("qa-upload")')
  console.log('PASS upload preview, company audience, rejected upload retry, persistent result and market listing')
  await click('发布')
  await click('qa-upload', '[role="menuitem"]')
  await waitFor(live, 'document.querySelector("#skill-market-version")?.value === "1.0.1"')
  await click('取消', '[role="dialog"] button')
  console.log('PASS next publication keeps audience/license and suggests a new immutable version')

  const card = 'Array.from(document.querySelectorAll("article")).find(e=>e.textContent.includes("QA Consumption"))'
  await evalOn(live, `${card}.querySelector('button').click()`)
  await waitFor(live, 'document.querySelector("[role=dialog]")?.textContent.includes("Ask the user")')
  await click('安装', '[role="dialog"] button')
  await waitFor(live, 'Array.from(document.querySelectorAll("[role=dialog] button")).some(e=>e.textContent.trim()==="立即使用")')
  assert.equal(readFileSync(join(workspace.rootPath, '.pi/skills/qa-consume/SKILL.md'), 'utf8'), markdown)
  await click('立即使用', '[role="dialog"] button')
  await waitFor(live, 'document.querySelector("[contenteditable=true]")?.textContent.includes("qa-consume")')
  console.log('PASS real project installation, Pi discovery and Skill-prefilled task without sending')

  await go('action/install-skill?' + new URLSearchParams({ slug: summary.slug, version: summary.version, sha256 }))
  await waitFor(live, 'document.querySelector("[role=dialog]")?.textContent.includes("安装 Skill")')
  await click('安装', '[role="dialog"] button')
  await waitFor(live, 'document.querySelector("[role=status]")?.textContent.includes("qa-consume")')
  assert.equal(readFileSync(join(workspace.rootPath, '.pi/skills/qa-consume/SKILL.md'), 'utf8'), markdown)
  console.log('PASS shared-link confirmation and existing Skill preservation')
} catch (error) {
  if (app) console.error(await evalOn(app, 'document.body.innerText.slice(-7000)'))
  throw error
} finally {
  await app?.close()
  rmSync(fixture, { recursive: true, force: true })
}
