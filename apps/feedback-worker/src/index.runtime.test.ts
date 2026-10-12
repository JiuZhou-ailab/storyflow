// input: Worker source, Wrangler rate-limit config, and local workerd
// output: Native binding enforcement through the Worker HTTP entry point
// pos: Runtime check complementing HTTP tests with external service fakes
import { expect, it } from 'bun:test'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

it('enforces the configured IP limit in local workerd', async () => {
  const config = Bun.TOML.parse(await Bun.file(join(import.meta.dir, '../wrangler.toml')).text()) as {
    ratelimits: Array<{ name: string; namespace_id: string; simple: { limit: number; period: number } }>
  }
  const bundle = await build({ entryPoints: [join(import.meta.dir, 'index.ts')], bundle: true, platform: 'neutral', format: 'esm', write: false })
  const script = `
    import { Miniflare } from ${JSON.stringify(pathToFileURL(require.resolve('miniflare')).href)};
    const mf = new Miniflare({
      modules: true, script: ${JSON.stringify(bundle.outputFiles[0]!.text)},
      ratelimits: ${JSON.stringify(Object.fromEntries(config.ratelimits.map(({ name, ...options }) => [name, options])))},
    });
    try {
      const send = ip => mf.dispatchFetch('https://feedback.example.com/api/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: '{}',
      });
      const statuses = [];
      for (let i = 0; i < 6; i++) statuses.push((await send('192.0.2.1')).status);
      const other = (await send('192.0.2.2')).status;
      console.log('RESULT:' + JSON.stringify({ statuses, other }));
    } finally { await mf.dispose(); }
  `
  const child = Bun.spawn(['node', '--input-type=module', '--eval', script], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 20_000)
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  clearTimeout(timer)
  expect(exit, stderr).toBe(0)
  const result = JSON.parse(stdout.split('RESULT:')[1]!.trim())
  expect(result.statuses).toEqual([400, 400, 400, 400, 400, 429])
  expect(result.other).toBe(400)
}, 30_000)
