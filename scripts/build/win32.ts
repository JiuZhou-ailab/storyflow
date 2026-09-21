// input: Windows build configuration, downloaded runtimes, and Electron sources
// output: Built and packaged Windows Electron artifacts with staged subprocess resources
// pos: Windows-specific release build implementation

/**
 * Windows-specific build logic (Node.js only - no Bun dependencies)
 *
 * Note: This contains extensive workarounds for Windows Defender and file locking issues.
 * These are necessary for reliable CI builds on Windows.
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { BuildConfig } from './common';

/**
 * Sleep helper (Node.js replacement for Bun.sleep)
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a shell command with proper Windows handling
 */
function run(command: string, cwd: string): void {
  console.log(`    > ${command}`);
  execSync(command, {
    cwd,
    stdio: 'inherit',
    shell: true,
  });
}

/**
 * Run a shell command silently, ignoring errors
 */
function runQuiet(command: string, cwd: string): void {
  try {
    execSync(command, {
      cwd,
      stdio: 'pipe',
      shell: true,
    });
  } catch {
    // Ignore errors
  }
}

/**
 * Kill processes that might lock files
 */
async function killLockingProcesses(): Promise<void> {
  const processesToKill = ['node', 'npm', 'electron', 'electron-builder'];

  for (const procName of processesToKill) {
    runQuiet(`taskkill /F /IM ${procName}.exe 2>nul`, process.cwd());
  }

  // Give processes time to fully terminate
  await sleep(2000);
}

/**
 * Safely remove a directory with exponential backoff retry
 * Windows file locking can cause transient failures
 */
async function safeRmDir(dir: string, maxRetries = 5): Promise<void> {
  if (!existsSync(dir)) return;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      // Verify it's actually gone
      if (!existsSync(dir)) {
        return;
      }
    } catch (error) {
      lastError = error as Error;
    }

    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
    const delay = 500 * Math.pow(2, attempt);
    console.log(`    Directory still locked, retrying in ${delay}ms...`);
    await sleep(delay);
  }

  if (existsSync(dir)) {
    throw new Error(`Failed to remove ${dir} after ${maxRetries} attempts: ${lastError?.message}`);
  }
}

/**
 * Build main process through the shared root script so auth defines and release
 * guards stay identical across macOS, Linux, and Windows.
 */
function buildMainProcess(config: BuildConfig): void {
  const { rootDir } = config;

  console.log('  Building main process...');
  run('bun run electron:build:main', rootDir);
}

/**
 * Build Electron app for Windows (with OAuth injection)
 */
export async function buildElectronAppWindows(config: BuildConfig): Promise<void> {
  const { rootDir, electronDir } = config;

  console.log('Building Electron app...');

  // Build main process with shared auth-aware release guards
  buildMainProcess(config);

  // Use the shared entrypoint so both preloads and compression stay identical.
  console.log('  Building preloads...');
  run('bun run electron:build:preload', rootDir);

  // Build renderer - invoke vite directly via node
  console.log('  Building renderer...');
  const rendererDir = join(electronDir, 'dist', 'renderer');
  if (existsSync(rendererDir)) {
    rmSync(rendererDir, { recursive: true, force: true });
  }
  run('node --max-old-space-size=4096 ./node_modules/vite/bin/vite.js build --config apps/electron/vite.config.ts', rootDir);

  // Verify renderer was built
  if (!existsSync(join(rendererDir, 'index.html'))) {
    throw new Error('Renderer build verification failed: index.html not found');
  }
  console.log('  Renderer build verified ✓');

  // Share staging and non-empty resource validation with macOS/Linux.
  run('bun run electron:build:assets', rootDir);
  run('bun run electron:build:validate', rootDir);
}

/**
 * Package the Windows app with electron-builder (with retry logic)
 */
export async function packageWindows(config: BuildConfig): Promise<string> {
  const { electronDir } = config;

  console.log('Packaging app with electron-builder...');

  // Kill any lingering processes first
  await killLockingProcesses();

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`  electron-builder attempt ${attempt} of ${maxRetries}...`);

    // Clean release directory before each attempt
    const releaseDir = join(electronDir, 'release');
    if (existsSync(releaseDir)) {
      console.log('  Cleaning release directory...');
      await safeRmDir(releaseDir);
    }

    try {
      // Run electron-builder from electronDir using npx (npx traverses up to find it in root node_modules)
      run('npx electron-builder --win --x64', electronDir);
      console.log(`  electron-builder succeeded on attempt ${attempt} ✓`);
      lastError = null;
      break;
    } catch (error) {
      lastError = error as Error;
      console.log(`  electron-builder failed on attempt ${attempt}`);

      if (attempt < maxRetries) {
        console.log('  Waiting 10 seconds before retry...');
        await killLockingProcesses();
        await sleep(10000);
      }
    }
  }

  if (lastError) {
    throw new Error(`electron-builder failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  // Find the built installer
  const releaseDir = join(electronDir, 'release');
  const files = readdirSync(releaseDir);
  const exeFile = files.find((f) => f.endsWith('.exe') && !f.includes('blockmap'));

  if (!exeFile) {
    console.error('Contents of release directory:');
    console.error(files.join('\n'));
    throw new Error('Installer not found in release directory');
  }

  const exePath = join(releaseDir, exeFile);

  // Get file size using Node.js fs
  const stats = statSync(exePath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log(`\n=== Build Complete ===`);
  console.log(`Installer: ${exePath}`);
  console.log(`Size: ${sizeMB} MB`);

  return exePath;
}
