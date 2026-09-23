// input: Native Electron application output, final archives, and reviewed byte budgets
// output: Verified content inventories, archive hashes, size breakdowns and a failing release gate
// pos: Final desktop artifact boundary before publishing; also supports explicit local measurement
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { path7za } from '7zip-bin';
import { SUPPORTED_LANGUAGE_CODES } from '../../packages/shared/src/i18n/languages';
import { validateAssets } from '../../apps/electron/scripts/validate-assets';
import { BUN_VERSION, UV_VERSION, type Platform, type Arch } from './common';

type Entry = { path: string; bytes: number; link?: string; executableBits?: number };
const rootDir = resolve(import.meta.dir, '../..');

function inventory(root: string, checkExecutableBits: boolean): Entry[] {
  const files: Entry[] = [];
  const canonicalRoot = realpathSync(root);
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      const stat = lstatSync(file);
      const path = relative(root, file).split(sep).join('/');
      if (stat.isSymbolicLink()) {
        const target = realpathSync(file);
        if (!target.startsWith(canonicalRoot + sep)) throw new Error(`Package symlink escapes its root: ${path}`);
        files.push({ path, bytes: 0, link: readlinkSync(file) });
      } else if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push({ path, bytes: stat.size, ...(checkExecutableBits ? { executableBits: stat.mode & 0o111 } : {}) });
      else throw new Error(`Unsupported package entry: ${path}`);
    }
  }
  walk(root);
  if (!files.length) throw new Error(`Empty package: ${root}`);
  return files;
}

export function inspectPackage(appPath: string, platform: Platform, arch: Arch) {
  const files = inventory(appPath, platform === 'darwin');
  const resourcePrefix = platform === 'darwin' ? 'Contents/Resources/' : 'resources/';
  const resources = join(appPath, resourcePrefix);
  const required = (path: string) => {
    if (!files.some(file => file.path === path && file.bytes > 0)) throw new Error(`Missing or empty runtime: ${path}`);
  };
  const runtimeFiles = files.filter(file => file.path.startsWith(resourcePrefix));
  for (const file of runtimeFiles) {
    const path = file.path.slice(resourcePrefix.length);
    if (/\.map$/.test(path)
      || (path.startsWith('app/') && !/^app\/(?:dist\/|vendor\/bun\/|node_modules\/@vscode\/ripgrep-binary\/|package\.json$)/.test(path))
      || /^app\/dist\/(?:src|tests|__tests__)\//.test(path)
      || /^app\/[^/]+\.(?:[cm]?[jt]s|ya?ml|tsbuildinfo)$/.test(path)
      || /^app\/dist\/resources\/(?:Assets\.car$|icon\.icns$|icon\.icon\/|dmg-background)/.test(path)
      || /^app\/dist\/resources\/scripts\/tests\//.test(path)
      || /\/__pycache__\//.test(path)) throw new Error(`Forbidden package file: ${path}`);
    const binaryTarget = path.match(/\/resources\/bin\/((?:darwin|win32|linux)-(?:arm64|x64))\//)?.[1];
    if (binaryTarget && binaryTarget !== `${platform}-${arch}`) throw new Error(`Wrong-platform binary: ${path}`);
  }
  const bunName = platform === 'win32' ? 'bun.exe' : 'bun';
  const bunPath = platform === 'win32' ? `vendor/bun/${bunName}` : `app/vendor/bun/${bunName}`;
  required(resourcePrefix + bunPath);
  for (const file of runtimeFiles.filter(file => /^bun(?:\.exe)?$/.test(basename(file.path)))) {
    if (file.path !== resourcePrefix + bunPath) throw new Error(`Duplicate Bun: ${file.path.slice(resourcePrefix.length)}`);
  }
  const piName = platform === 'win32' ? 'pi-agent-server.exe' : 'pi-agent-server';
  const piPath = `app/dist/resources/pi-agent-server/${piName}`;
  required(resourcePrefix + piPath);
  for (const file of runtimeFiles.filter(file => /^pi-agent-server(?:\.exe)?$/.test(basename(file.path)))) {
    if (file.path !== resourcePrefix + piPath) throw new Error(`Duplicate Pi: ${file.path}`);
  }
  required(`${resourcePrefix}app/dist/resources/bin/${platform}-${arch}/${platform === 'win32' ? 'uv.exe' : 'uv'}`);
  required(`${resourcePrefix}app/node_modules/@vscode/ripgrep-binary/bin/${platform === 'win32' ? 'rg.exe' : 'rg'}`);
  required(`${resourcePrefix}app/node_modules/@vscode/ripgrep-binary/LICENSE`);
  required(`${resourcePrefix}messaging-whatsapp-worker/worker.cjs`);
  required(`${resourcePrefix}app/package.json`);
  if (platform === 'darwin') {
    required(`${resourcePrefix}icon.icns`);
    required(`${resourcePrefix}Assets.car`);
  } else required(`${resourcePrefix}app/dist/resources/icon.${platform === 'win32' ? 'ico' : 'png'}`);
  validateAssets(join(resources, 'app/dist'), platform);
  const aliases: Record<string, string[]> = platform === 'darwin'
    ? { en: ['en', 'en_GB'], 'zh-Hans': ['zh_CN'] }
    : { en: ['en-US', 'en-GB'], 'zh-Hans': ['zh-CN'] };
  const languages = SUPPORTED_LANGUAGE_CODES.flatMap(code => aliases[code] ?? [code]);
  const locales = files.filter(file => platform === 'darwin'
    ? /Electron Framework\.framework\/Versions\/[^/]+\/Resources\/[^/]+\.lproj\/locale\.pak$/.test(file.path)
    : /^locales\/[^/]+\.pak$/.test(file.path));
  for (const language of languages) {
    if (!locales.some(file => file.bytes > 0 && file.path.endsWith(platform === 'darwin' ? `/${language}.lproj/locale.pak` : `/${language}.pak`))) {
      throw new Error(`Missing Electron locale: ${language}`);
    }
  }
  for (const file of locales) {
    const language = platform === 'darwin' ? file.path.split('/').at(-2)!.slice(0, -6) : basename(file.path, '.pak');
    if (!languages.includes(language)) throw new Error(`Unexpected Electron locale: ${file.path}`);
  }
  const components: Record<string, number> = {};
  for (const file of files) {
    const path = file.path;
    const component = /\/vendor\/bun\//.test(path) ? 'bun'
      : /\/pi-agent-server\//.test(path) ? 'pi'
      : /\/bin\/[^/]+\/uv(?:\.exe)?$/.test(path) ? 'uv'
      : /\/dist\/main\.cjs$/.test(path) ? 'main'
      : /\/dist\/renderer\//.test(path) ? 'renderer'
      : /messaging-whatsapp-worker\//.test(path) ? 'whatsapp'
      : path.startsWith(resourcePrefix + 'app/') ? 'app-resources' : 'electron-and-native-resources';
    components[component] = (components[component] ?? 0) + file.bytes;
  }
  return { bytes: files.reduce((sum, file) => sum + file.bytes, 0), components, files };
}

export function checkBudget(bytes: number, limit: number | null | undefined, label: string): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`Invalid measured size: ${label}`);
  if (!Number.isSafeInteger(limit) || limit! <= 0) throw new Error(`Missing or unapproved byte budget: ${label}`);
  if (bytes > limit!) throw new Error(`Size budget exceeded: ${label}: ${bytes} > ${limit} bytes`);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Compare complete contents, including symlinks; listing an archive alone cannot
// prove that it contains the same application we just validated.
export async function verifyArchive(archive: string, appPath: string, platform: Platform, arch: Arch) {
  const temp = mkdtempSync(join(tmpdir(), 'storyflow-archive-'));
  const extension = archive.split('.').at(-1);
  const isDmg = extension === 'dmg';
  let mounted = false;
  try {
    if (isDmg) {
      execFileSync('hdiutil', ['verify', archive], { stdio: 'pipe' });
      execFileSync('hdiutil', ['attach', archive, '-readonly', '-nobrowse', '-mountpoint', temp], { stdio: 'pipe' });
      mounted = true;
    } else if (extension === 'zip' && platform === 'darwin') {
      execFileSync('ditto', ['-xk', archive, temp], { stdio: 'pipe' });
    } else if (extension === 'exe' && platform === 'win32') {
      // 7zip-bin also recognizes electron-builder's embedded NSIS 7z payload.
      // It fails if the installer changes format; never treat an empty listing as success.
      if (process.platform !== 'win32') chmodSync(path7za, 0o755);
      execFileSync(path7za, ['x', '-y', `-o${temp}`, archive], { stdio: 'pipe' });
    } else throw new Error(`Unsupported archive: ${archive}`);
    const extractedApp = platform === 'darwin' ? join(temp, 'Storyflow.app') : temp;
    const source = inspectPackage(appPath, platform, arch);
    const extracted = inspectPackage(extractedApp, platform, arch);
    if (JSON.stringify(source.files) !== JSON.stringify(extracted.files)) {
      const difference = source.files.find((file, index) => JSON.stringify(file) !== JSON.stringify(extracted.files[index]))
        ?? extracted.files[source.files.length];
      throw new Error(`Archive content or executable bits differ: ${archive}: ${difference?.path}`);
    }
    for (const file of source.files.filter(file => !file.link)) {
      if (await sha256(join(appPath, file.path)) !== await sha256(join(extractedApp, file.path))) {
        throw new Error(`Archive file hash mismatch: ${archive}: ${file.path}`);
      }
    }
    return { name: basename(archive), format: extension, bytes: lstatSync(archive).size, sha256: await sha256(archive), contentVerified: true };
  } finally {
    if (mounted) execFileSync('hdiutil', ['detach', temp], { stdio: 'pipe' });
    rmSync(temp, { recursive: true, force: true });
  }
}

function signatureStatus(appPath: string, platform: Platform): string {
  if (platform === 'darwin') {
    const verification = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' });
    if (verification.status !== 0) return 'unsigned-or-invalid';
    const info = spawnSync('codesign', ['--display', '--verbose=2', appPath], { encoding: 'utf8' });
    return info.stderr.includes('Signature=adhoc') ? 'adhoc' : 'valid';
  }
  if (process.platform === 'win32') {
    const info = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '& { param($p) $ErrorActionPreference = \"Stop\"; (Get-AuthenticodeSignature -LiteralPath $p).Status.ToString() }', join(appPath, 'Storyflow.exe')], { encoding: 'utf8' });
    return info.trim();
  }
  return 'not-checked-on-this-host';
}

async function main() {
  const { values } = parseArgs({ options: {
    platform: { type: 'string' }, arch: { type: 'string' }, 'release-dir': { type: 'string' },
    'measure-only': { type: 'boolean', default: false },
  } });
  const platform = values.platform ?? process.platform;
  const arch = values.arch ?? process.arch;
  if ((platform !== 'darwin' && platform !== 'win32') || (arch !== 'arm64' && arch !== 'x64') || (platform === 'win32' && arch !== 'x64')) {
    throw new Error(`Unsupported release target: ${platform}-${arch}`);
  }
  const releaseDir = resolve(values['release-dir'] ?? join(rootDir, 'apps/electron/release'));
  const appPath = platform === 'darwin' ? join(releaseDir, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Storyflow.app') : join(releaseDir, 'win-unpacked');
  const formats = platform === 'darwin' ? ['dmg', 'zip'] : ['exe'];
  const artifacts: Awaited<ReturnType<typeof verifyArchive>>[] = [];
  const failures: string[] = [];
  let application: ReturnType<typeof inspectPackage> | null = null;
  try {
    application = inspectPackage(appPath, platform, arch);
    for (const format of formats) artifacts.push(await verifyArchive(join(releaseDir, `Storyflow-${arch}.${format}`), appPath, platform, arch));
  } catch (error) {
    failures.push((error as Error).message);
  }
  const contentVerified = failures.length === 0;
  const budgets = JSON.parse(readFileSync(join(import.meta.dir, 'package-size-budgets.json'), 'utf8'));
  const targetBudget = budgets[`${platform}-${arch}`];
  if (!values['measure-only'] && contentVerified && application) {
    for (const [label, bytes] of [['application', application.bytes], ...artifacts.map(a => [a.format, a.bytes])] as [string, number][]) {
      try { checkBudget(bytes, targetBudget?.[label], `${platform}-${arch}/${label}`); }
      catch (error) { failures.push((error as Error).message); }
    }
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' });
  const report = {
    schemaVersion: 1, platform, arch, sourceCommit: git('rev-parse', 'HEAD').trim(),
    dirty: git('status', '--porcelain').length > 0,
    trackedDiffSha256: createHash('sha256').update(git('diff', 'HEAD', '--binary')).digest('hex'),
    lockSha256: await sha256(join(rootDir, 'bun.lock')),
    toolchain: { bun: process.versions.bun, node: execFileSync('node', ['--version'], { encoding: 'utf8' }).trim(), bundledBun: BUN_VERSION, uv: UV_VERSION,
      electronBuilder: JSON.parse(readFileSync(require.resolve('app-builder-lib/package.json'), 'utf8')).version,
      electron: JSON.parse(readFileSync(join(rootDir, 'node_modules/electron/package.json'), 'utf8')).version },
    signature: application ? signatureStatus(appPath, platform) : 'not-checked', application, artifacts, contentVerified,
    budgetStatus: values['measure-only'] || !contentVerified ? 'not-evaluated' : failures.length ? 'failed' : 'passed', failures,
  };
  const reportPath = join(releaseDir, `package-report-${platform}-${arch}.json`);
  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Package content: ${contentVerified ? 'verified' : 'failed'}. Budget: ${report.budgetStatus}. Report: ${reportPath}`);
  if (failures.length) throw new Error(failures.join('\n'));
}

if (import.meta.main) await main();
