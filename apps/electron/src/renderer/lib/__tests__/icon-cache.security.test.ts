// input: Untrusted SVG and the installed Electron Chromium runtime
// output: Native parsing and inline rendering regression coverage
// pos: Exercises the SVG renderer trust boundary without a DOM shim
import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

// Linux CI runners lack a SUID chrome-sandbox; this test covers renderer boundaries, not the OS sandbox.
const LINUX_CI_SANDBOX_ARGS = process.platform === 'linux' ? ['--no-sandbox'] : []

it('removes active SVG content and preserves renderable currentColor geometry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'icon-security-'))
  try {
    const bundle = await build({
      entryPoints: [join(import.meta.dir, '../icon-cache.ts')],
      bundle: true, platform: 'browser', format: 'iife', globalName: 'icons', write: false,
    })
    const payloads = [
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">bad</div></foreignObject>',
      '<a href="javascript&#58;alert(1)"><path d="M0 0h2v2z"/></a>',
      '<use href="https://evil.example/icon.svg#x"/>',
      '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="//evil.example/x"/>',
      '<style>path{fill:url(https://evil.example/x)}</style>',
      '<iframe src="https://evil.example"/>',
      '<image href="data:text/html,bad"/>',
      '<script>alert(1)</script>',
      '<path onload="alert(1)" style="fill:url(https://evil.example/x)" fill="url(https://evil.example/x)"/>',
      '<path fill="u&#114;l(https://evil.example/x)"/>',
      '<animate attributeName="href" to="https://evil.example"/>',
      '<path xmlns="http://www.w3.org/1999/xhtml"/>',
    ].map(body => `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor">${body}</svg>`)
    payloads.push('<svg onload=alert(1) fill="currentColor"></svg>', '<svg><path></svg>')
    const valid = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><defs><path id="shape" d="M0 0h10v10z"/></defs><use href="#shape"/><circle cx="12" cy="12" r="4" stroke="currentColor" fill="none"/></svg>'
    const expression = `${bundle.outputFiles[0]!.text}\n(() => {
      const clean = ${JSON.stringify(payloads)}.map(value => icons.sanitizeSvgForInline(value));
      const valid = icons.sanitizeSvgForInline(${JSON.stringify(valid)});
      document.body.style.color = 'rgb(12, 34, 56)';
      document.body.innerHTML = valid;
      const svg = document.querySelector('svg');
      return { clean, valid, fill: getComputedStyle(svg).fill, width: svg.getBBox().width };
    })()`
    const script = join(dir, 'run.cjs')
    // Electron resolves this builtin by name; an absolute npm entry returns its binary path.
    await writeFile(script, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(dir, 'profile'))});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadURL('about:blank');
  console.log('RESULT:' + JSON.stringify(await win.webContents.executeJavaScript(${JSON.stringify(expression)})));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = Bun.spawn([require('electron') as string, ...LINUX_CI_SANDBOX_ARGS, script], { env, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 20_000)
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    clearTimeout(timer)
    expect(exit, stderr).toBe(0)
    const result = JSON.parse(stdout.split('RESULT:')[1]!.trim())
    for (const clean of result.clean) {
      expect(clean).not.toMatch(/foreignObject|javascript|evil\.example|<style|<iframe|<image|<script|onload|<animate|xhtml/)
    }
    expect(result.clean.slice(-2)).toEqual(['', ''])
    expect(result.valid).toContain('viewBox="0 0 24 24"')
    expect(result.valid).toContain('href="#shape"')
    expect(result.valid).toContain('currentColor')
    expect(result.valid).not.toMatch(/\s(?:width|height)=/)
    expect(result.fill).toBe('rgb(12, 34, 56)')
    expect(result.width).toBeGreaterThan(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30_000)
