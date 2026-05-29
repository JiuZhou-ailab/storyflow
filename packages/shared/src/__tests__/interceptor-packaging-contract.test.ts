// input: Electron packaging config and build scripts
// output: Regression coverage for staging interceptor runtime dependencies
// pos: Shared packaging contract test for the Pi interceptor packaging path

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

describe('interceptor packaging contract', () => {
  it('stages interceptor-request-utils.ts through build scripts without adding source files to electron-builder', () => {
    const builderYml = readRepoFile('apps/electron/electron-builder.yml');
    const dmgScript = readRepoFile('apps/electron/scripts/build-dmg.sh');
    const linuxScript = readRepoFile('apps/electron/scripts/build-linux.sh');
    const winScript = readRepoFile('apps/electron/scripts/build-win.ps1');
    const commonBuild = readRepoFile('scripts/build/common.ts');

    expect(builderYml).not.toContain('packages/shared/src/interceptor-request-utils.ts');
    expect(commonBuild).toContain("join(sourceDir, 'interceptor-request-utils.ts')");
    expect(dmgScript).toContain('interceptor-request-utils.ts');
    expect(linuxScript).toContain('interceptor-request-utils.ts');
    expect(winScript).toContain('interceptor-request-utils.ts');
  });
});
