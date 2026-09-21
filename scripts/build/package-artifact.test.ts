// input: Real filesystem and archives at the packaged Electron boundary
// output: Content and budget rejection checks independent of builder config strings
// pos: Regression seam for the final artifact gate
import { execFileSync } from 'node:child_process';
import { expect, test } from 'bun:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { path7za } from '7zip-bin';
import { inspectPackage, checkBudget, verifyArchive } from './package-artifact';

function fixture(platform: 'darwin' | 'win32' = 'darwin') {
  const windows = platform === 'win32';
  const root = mkdtempSync(join(tmpdir(), 'storyflow-artifact-'));
  const app = join(root, windows ? 'win-unpacked' : 'Storyflow.app');
  const resources = join(app, windows ? 'resources' : 'Contents/Resources');
  const dist = join(resources, 'app/dist');
  const put = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'fixture'); };
  cpSync(join(import.meta.dir, '../../apps/electron/resources'), join(dist, 'resources'), {
    recursive: true,
    filter: source => !/(?:pi-agent-server|darwin-arm64|darwin-x64|win32-x64|linux-x64|linux-arm64|icon\.icon|Assets\.car|icon\.icns|dmg-background[^/]*|__pycache__|\/tests)(?:\/|$|\.)/.test(source),
  });
  for (const path of ['main.cjs', 'bootstrap-preload.cjs', 'browser-toolbar-preload.cjs', 'renderer/index.html',
    `resources/pi-agent-server/pi-agent-server${windows ? '.exe' : ''}`,
    windows ? 'resources/bin/win32-x64/uv.exe' : 'resources/bin/darwin-arm64/uv',
    'resources/bin/markitdown', 'resources/bin/markitdown.cmd', 'resources/powershell-parser.ps1']) put(join(dist, path));
  for (const path of ['icon.icns', 'Assets.car', 'app/package.json', windows ? 'vendor/bun/bun.exe' : 'app/vendor/bun/bun',
    `app/node_modules/@vscode/ripgrep-binary/bin/rg${windows ? '.exe' : ''}`, 'app/node_modules/@vscode/ripgrep-binary/LICENSE', 'messaging-whatsapp-worker/worker.cjs']) put(join(resources, path));
  for (const lang of windows ? ['en-US', 'en-GB', 'es', 'zh-CN', 'ja', 'hu', 'de', 'pl'] : ['en', 'en_GB', 'es', 'zh_CN', 'ja', 'hu', 'de', 'pl']) {
    put(join(app, windows ? `locales/${lang}.pak` : `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/${lang}.lproj/locale.pak`));
  }
  return { root, app, resources, put };
}

test('actual package rejects missing runtime, a second Bun, source maps and wrong-platform binaries', () => {
  const f = fixture();
  try {
    const report = inspectPackage(f.app, 'darwin', 'arm64');
    expect(report.bytes).toBeGreaterThan(0);
    expect(report.files.length).toBeGreaterThan(20);
    for (const path of ['app/vendor/bun/bun.exe', 'app/dist/main.cjs.map', 'app/src/main.ts', 'app/tests/main.test.ts', 'app/dist/resources/bin/darwin-x64/uv', 'app/dist/resources/bin/win32-x64/uv.exe']) {
      f.put(join(f.resources, path));
      expect(() => inspectPackage(f.app, 'darwin', 'arm64')).toThrow(path);
      rmSync(join(f.resources, path));
    }
    for (const path of ['app/dist/resources/scripts/docx_tool.py', 'app/dist/resources/bin/pptx-tool.cmd']) {
      const saved = readFileSync(join(f.resources, path));
      rmSync(join(f.resources, path));
      expect(() => inspectPackage(f.app, 'darwin', 'arm64')).toThrow(path.replace('app/dist/', ''));
      writeFileSync(join(f.resources, path), saved);
    }
    rmSync(join(f.resources, 'app/vendor/bun/bun'));
    expect(() => inspectPackage(f.app, 'darwin', 'arm64')).toThrow('bun');
    expect(() => inspectPackage(join(f.root, 'missing'), 'darwin', 'arm64')).toThrow();
    expect(() => checkBudget(20, 19, 'zip')).toThrow('zip');
    expect(() => checkBudget(20, null, 'zip')).toThrow('unapproved');
    expect(() => checkBudget(20, 20, 'zip')).not.toThrow();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== 'darwin')('ZIP gate checks extracted bytes, not just archive size or a listing', async () => {
  const f = fixture();
  try {
    const archive = join(f.root, 'Storyflow-arm64.zip');
    const bun = join(f.resources, 'app/vendor/bun/bun');
    chmodSync(bun, 0o755);
    execFileSync('ditto', ['-c', '-k', '--keepParent', f.app, archive]);
    expect((await verifyArchive(archive, f.app, 'darwin', 'arm64')).contentVerified).toBe(true);
    chmodSync(bun, 0o644);
    await expect(verifyArchive(archive, f.app, 'darwin', 'arm64')).rejects.toThrow('bun');
    chmodSync(bun, 0o755);
    writeFileSync(join(f.resources, 'app/dist/main.cjs'), 'changed'); // same byte length
    await expect(verifyArchive(archive, f.app, 'darwin', 'arm64')).rejects.toThrow('hash mismatch');
    writeFileSync(archive, 'not an archive');
    await expect(verifyArchive(archive, f.app, 'darwin', 'arm64')).rejects.toThrow();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('Windows gate extracts the embedded 7z payload and rejects a missing worker', async () => {
  const f = fixture('win32');
  try {
    const archive = join(f.root, 'Storyflow-x64.exe');
    execFileSync(path7za, ['a', '-t7z', archive, '.'], { cwd: f.app, stdio: 'pipe' });
    writeFileSync(archive, Buffer.concat([Buffer.from('MZ installer stub'), readFileSync(archive), Buffer.from('installer tail')]));
    expect((await verifyArchive(archive, f.app, 'win32', 'x64')).contentVerified).toBe(true);
    rmSync(join(f.resources, 'messaging-whatsapp-worker/worker.cjs'));
    await expect(verifyArchive(archive, f.app, 'win32', 'x64')).rejects.toThrow('worker.cjs');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}, 30_000);
