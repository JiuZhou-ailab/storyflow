// input: Electron resources, bundled assets, and built subprocess bundles
// output: dist/resources tree with static assets and subprocess runtime entrypoints
// pos: Electron-local resource copy step used by platform packaging scripts

import { cpSync, copyFileSync, rmSync } from 'fs';
import { join } from 'path';
import { resolveBuildTargetFromEnv, stageSubprocessResources } from '../../../scripts/build/resource-staging.ts';

const electronDir = join(import.meta.dir, '..');
const rootDir = join(electronDir, '..', '..');
const target = resolveBuildTargetFromEnv();

stageSubprocessResources({
  rootDir,
  electronDir,
  platform: target.platform,
  arch: target.arch,
});

// Copy all resources (icons, themes, docs, permissions, tool-icons, etc.)
rmSync('dist/resources', { recursive: true, force: true });
cpSync('resources', 'dist/resources', { recursive: true });

console.log('✓ Copied resources/ → dist/resources/');

// Copy PowerShell parser script (for Windows command validation in Explore mode)
// Source: packages/shared/src/agent/powershell-parser.ps1
// Destination: dist/resources/powershell-parser.ps1
const psParserSrc = join('..', '..', 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1');
const psParserDest = join('dist', 'resources', 'powershell-parser.ps1');
try {
  copyFileSync(psParserSrc, psParserDest);
  console.log('✓ Copied powershell-parser.ps1 → dist/resources/');
} catch (err) {
  // Only warn - PowerShell validation is optional on non-Windows platforms
  console.log('⚠ powershell-parser.ps1 copy skipped (not critical on non-Windows)');
}
