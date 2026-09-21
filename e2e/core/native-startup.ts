// input: Real Electron binary and production WindowManager/recovery source
// output: Visible, bounded missing-page/preload/crash recovery evidence
// pos: Native half of #45 startup acceptance; no network/model calls
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const root = mkdtempSync(join(tmpdir(), 'storyflow-native-startup-'))
const electron = createRequire(import.meta.url)('electron') as string
try {
  await build({ entryPoints: [join(import.meta.dir, 'native-startup.fixture.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(root, 'main.cjs') })
  mkdirSync(join(root, 'renderer'))
  for (const scenario of ['missing', 'preload', 'crash']) {
    if (scenario !== 'missing') writeFileSync(join(root, 'renderer/index.html'), '<!doctype html><title>Startup fixture</title>')
    writeFileSync(join(root, 'bootstrap-preload.cjs'), scenario === 'preload' ? 'throw new Error("secret-fixture-content")' : '')
    const proc = Bun.spawn([electron, join(root, 'main.cjs')], {
      env: { ...process.env, VITE_DEV_SERVER_URL: '', CRAFT_CONFIG_DIR: join(root, 'config'), STARTUP_FIXTURE_ROOT: root, STARTUP_FIXTURE_CASE: scenario, HOME: root, CRAFT_DISABLE_FILE_LOG: '1' },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    assert.equal(code, 0, `${scenario}: ${stdout}\n${stderr}`)
    const result = JSON.parse(stdout.split('\n').find(line => line.startsWith('STARTUP_RESULT='))!.slice('STARTUP_RESULT='.length))
    assert.equal(result.code, scenario === 'preload' ? 'PRELOAD' : scenario === 'crash' ? 'RENDERER_CRASH' : 'RENDERER_LOAD')
    const receipt = readFileSync(join(root, 'logs/startup.jsonl'), 'utf8')
    assert.ok(!receipt.includes(root) && !receipt.includes('secret-fixture-content'))
    console.log(`PASS ${scenario}: one visible recovery, no unhandled rejection, redacted receipt`)
  }
  const relaunch = Bun.spawn([electron, join(root, 'main.cjs'), '--restore-config-backup=once.json'], {
    env: { ...process.env, STARTUP_FIXTURE_ROOT: root, STARTUP_FIXTURE_CASE: 'relaunch', HOME: root },
    stdout: 'ignore', stderr: 'ignore',
  })
  const relaunchDeadline = setTimeout(() => relaunch.kill(), 10_000)
  try {
    assert.equal(await relaunch.exited, 0)
    const result = join(root, 'relaunch-result.json')
    const deadline = Date.now() + 10_000
    while (!existsSync(result) && Date.now() < deadline) await Bun.sleep(100)
    const args: string[] = JSON.parse(readFileSync(result, 'utf8'))
    assert.ok(!args.some(arg => arg.startsWith('--restore-config-backup=')))
    console.log('PASS relaunch: real Electron consumes the one-shot backup argument')
  } finally { clearTimeout(relaunchDeadline) }
  await build({ entryPoints: [join(import.meta.dir, '../../apps/electron/src/main/entry.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(root, 'module.cjs'),
    plugins: [{ name: 'missing-main-fixture', setup(builder) {
      builder.onResolve({ filter: /^\.\/index$/ }, args => args.importer.endsWith('/main/entry.ts') ? { path: './missing-main.cjs', external: true } : undefined)
    } }],
  })
  const missingModule = Bun.spawn([electron, join(root, 'module.cjs'), `--user-data-dir=${root}`], {
    env: { ...process.env, CRAFT_HEADLESS: '1', HOME: root }, stdout: 'ignore', stderr: 'pipe',
  })
  const moduleTimeout = setTimeout(() => missingModule.kill(), 20_000)
  const [moduleCode, moduleError] = await Promise.all([missingModule.exited, new Response(missingModule.stderr).text()])
  clearTimeout(moduleTimeout)
  assert.equal(moduleCode, 1, moduleError)
  assert.ok(readFileSync(join(root, 'logs/startup.jsonl'), 'utf8').includes('main-module'))
  console.log('PASS main module: failure exit and independent diagnostic receipt')
} finally { rmSync(root, { recursive: true, force: true }) }
