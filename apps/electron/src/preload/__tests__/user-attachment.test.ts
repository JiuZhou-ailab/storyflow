// input: Chromium-native File objects and the real isolated preload adapter
// output: Native file provenance and synchronous IPC regression coverage
// pos: Verifies synthetic renderer Files cannot forge desktop attachment grants
import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

// Linux CI runners lack a SUID chrome-sandbox; this test covers renderer boundaries, not the OS sandbox.
const LINUX_CI_SANDBOX_ARGS = process.platform === 'linux' ? ['--no-sandbox'] : []

it('registers only real OS files across Electron context isolation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preload-file-'))
  try {
    const path = join(dir, 'native.txt')
    await writeFile(path, 'native')
    const preload = join(dir, 'preload.cjs')
    await build({
      stdin: { resolveDir: import.meta.dir, contents: `import { contextBridge } from 'electron';
import { getUserAttachmentPath } from ${JSON.stringify(join(import.meta.dir, '../user-attachment.ts'))};

contextBridge.exposeInMainWorld('attachment', { getPath: getUserAttachmentPath });` },
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: preload,
    })
    const script = join(dir, 'run.cjs')
    await writeFile(script, `const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(join(dir, 'profile'))});
const grants = [];
ipcMain.on('__files:registerUserAttachment', (event, path) => { grants.push(path); event.returnValue = true; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { preload: ${JSON.stringify(preload)}, sandbox: false, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('data:text/html,<input type="file" id="file">');
  win.webContents.debugger.attach('1.3');
  const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
  const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' });
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [${JSON.stringify(path)}] });
  const result = await win.webContents.executeJavaScript(
    '({ forged: attachment.getPath(Object.assign(new File(["fake"], "native.txt"), { path: ' + ${JSON.stringify(JSON.stringify(path))} + ' })), native: attachment.getPath(document.querySelector("input").files[0]) })'
  );
  console.log('RESULT:' + JSON.stringify({ ...result, grants }));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    // Other suites mock electron globally; resolve its binary in a fresh Bun process.
    const binary = Bun.spawnSync([process.execPath, '-e', "process.stdout.write(require('electron'))"])
    expect(binary.exitCode, binary.stderr.toString()).toBe(0)
    const child = Bun.spawn([binary.stdout.toString(), ...LINUX_CI_SANDBOX_ARGS, script], { env, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 20_000)
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    clearTimeout(timer)
    expect(exit, stderr).toBe(0)
    const result = JSON.parse(stdout.split('RESULT:')[1]!.trim())
    expect(result.forged).toBeNull()
    expect(result.native).toBe(path)
    expect(result.grants).toEqual([path])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30_000)
