/**
 * input: Electron build config, staged runtime assets, and macOS target architecture
 * output: A verified architecture-specific Storyflow DMG path
 * pos: macOS packaging gate for the desktop release pipeline
 *
 * macOS-specific build logic
 */

import { $ } from 'bun';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import type { Arch, BuildConfig } from './common';

/**
 * Verify SDK native binary is bundled in the packaged macOS app.
 * Since SDK 0.2.113 the SDK ships a per-platform native binary instead of cli.js.
 */
export function verifyPackagedSDK(appPath: string, _arch: Arch): void {
  const appResourcesPath = join(appPath, 'Contents', 'Resources', 'app');
  const binaryPath = join(
    appResourcesPath,
    'node_modules', '@anthropic-ai', 'claude-agent-sdk-binary', 'claude',
  );

  if (!existsSync(binaryPath)) {
    throw new Error(`CRITICAL: SDK native binary not bundled! Expected at: ${binaryPath}`);
  }

  const stats = statSync(binaryPath);
  if (stats.size < 50_000_000) {
    throw new Error(`CRITICAL: SDK native binary too small (${stats.size} bytes, expected ~210 MB)`);
  }

  console.log(`  SDK bundled: claude binary is ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
}

/**
 * Package the macOS app with electron-builder
 */
export async function packageDarwin(config: BuildConfig): Promise<string> {
  const { arch, electronDir } = config;

  console.log('Packaging app with electron-builder...');

  // Set up environment for electron-builder
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';

  // Build electron-builder arguments
  const builderArgs = ['--mac', `--${arch}`];

  // Add code signing if identity is available
  if (process.env.APPLE_SIGNING_IDENTITY) {
    // Strip "Developer ID Application: " prefix if present (electron-builder adds it automatically)
    const cscName = process.env.APPLE_SIGNING_IDENTITY.replace('Developer ID Application: ', '');
    console.log(`  Using signing identity: ${cscName}`);
    process.env.CSC_NAME = cscName;
  }

  // Add notarization if all credentials are available
  if (process.env.APPLE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('  Notarization enabled');
    process.env.NOTARIZE = 'true';
  }

  // Run electron-builder
  await $`cd ${electronDir} && npx electron-builder ${builderArgs}`;

  // Verify SDK is bundled in the .app before checking artifacts
  const macDir = arch === 'arm64' ? 'mac-arm64' : 'mac';
  const appPath = join(electronDir, 'release', macDir, 'Storyflow.app');
  console.log('Verifying SDK in packaged app...');
  verifyPackagedSDK(appPath, arch);

  // Verify the DMG was built.
  const dmgName = `Storyflow-${arch}.dmg`;
  const dmgPath = join(electronDir, 'release', dmgName);

  if (!existsSync(dmgPath)) {
    console.error('Contents of release directory:');
    await $`ls -la ${join(electronDir, 'release')}`;
    throw new Error(`Expected DMG not found at ${dmgPath}`);
  }

  // Get file sizes
  const dmgFile = Bun.file(dmgPath);
  const dmgSizeMB = ((await dmgFile.size) / 1024 / 1024).toFixed(2);

  console.log(`\n=== Build Complete ===`);
  console.log(`DMG: ${dmgPath} (${dmgSizeMB} MB)`);

  return dmgPath;
}
