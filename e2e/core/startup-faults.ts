// input: Built or packaged Electron and isolated malformed Host data
// output: Actual entrypoint failures with preserved data, redacted receipts, and nonzero exits
// pos: Black-box startup error-boundary acceptance; headless mode avoids modal interaction
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { launchApp, evalOn } from '../perf/launch'
const root = mkdtempSync(join(tmpdir(), 'storyflow-startup-faults-'))
const packaged = !!process.env.CRAFT_E2E_ELECTRON_BIN
const electron = process.env.CRAFT_E2E_ELECTRON_BIN ?? createRequire(import.meta.url)('electron') as string
try {
  for (const scenario of ['configInvalid', 'access', 'ownerUnknown', 'tls']) {
    const dir = join(root, scenario), config = join(dir, 'host'), profile = join(dir, 'profile')
    mkdirSync(config, { recursive: true }); mkdirSync(profile)
    const configPath = join(config, 'config.json')
    const original = scenario === 'configInvalid' ? '{secret-fixture-content' : JSON.stringify({ workspaces: [], activeWorkspaceId: null,
      ...(scenario === 'tls' ? { serverConfig: { enabled: true, port: 0, tlsCertPath: join(root, 'missing-cert') } } : {}) })
    if (scenario === 'access') mkdirSync(configPath)
    else writeFileSync(configPath, original)
    if (scenario === 'ownerUnknown') writeFileSync(join(config, '.server.lock'), String(process.pid))
    const proc = Bun.spawn([electron, ...(packaged ? [] : [resolve(import.meta.dir, '../../apps/electron')]), `--user-data-dir=${profile}`], {
      env: { ...process.env, CRAFT_CONFIG_DIR: config, CRAFT_HEADLESS: '1', CRAFT_CLIENT_AUTH_REQUIRED: 'false', HOME: dir },
      stdout: 'pipe', stderr: 'pipe',
    })
    const timeout = setTimeout(() => proc.kill(), 20_000)
    try {
      const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      assert.equal(code, 1, `${scenario}: expected failure exit; got ${code}\n${stdout}\n${stderr}`)
      if (scenario !== 'access') assert.equal(readFileSync(configPath, 'utf8'), original)
      const receipt = readFileSync(join(profile, 'logs/startup.jsonl'), 'utf8')
      assert.ok(receipt.includes(`"category":"${scenario}"`), receipt)
      assert.ok(!receipt.includes(root) && !receipt.includes('secret-fixture-content'))
      console.log(`PASS ${scenario}: preserved data, failure exit, diagnostic category`)
    } finally { clearTimeout(timeout) }
  }
  const tlsHome = join(root, 'tls-success')
  mkdirSync(tlsHome)
  const cert = join(tlsHome, 'cert.pem'), key = join(tlsHome, 'key.pem'), cnf = join(tlsHome, 'openssl.cnf')
  writeFileSync(cnf, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-config', cnf], { stdio: 'ignore' })
  writeFileSync(join(tlsHome, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null,
    serverConfig: { enabled: true, port: 0, tlsCertPath: cert, tlsKeyPath: key } }))
  const tlsApp = await launchApp(tlsHome, { executablePath: electron, packaged, userDataDir: join(tlsHome, 'profile') })
  try {
    const deadline = Date.now() + 15_000
    let connected = false
    while (Date.now() < deadline && !connected) {
      connected = await evalOn(tlsApp, `(async () => {
        if (!window.electronAPI) return false;
        await window.electronAPI.getWorkspaces();
        const state = await window.electronAPI.getTransportConnectionState();
        return state.status === 'connected' && state.url.startsWith('wss://');
      })()`).catch(() => false)
      if (!connected) await Bun.sleep(100)
    }
    assert.equal(connected, true, 'Actual preload could not use the embedded TLS endpoint')
    console.log('PASS TLS preload: real window and authenticated WSS RPC with scoped trust')
  } finally { await tlsApp.close() }
} finally { rmSync(root, { recursive: true, force: true }) }
