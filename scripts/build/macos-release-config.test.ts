// input: macOS release workflow and Electron builder configuration
// output: Regression coverage that official macOS releases are signed, notarized, and verified
// pos: Release safety guard preventing unsigned macOS artifacts from being published

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rootDir = join(import.meta.dir, '..', '..');

function readRepoFile(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8');
}

function writeMacManifest(path: string, arch: 'arm64' | 'x64'): void {
  writeFileSync(
    path,
    [
      'version: 0.9.11',
      'files:',
      `  - url: Craft-Agents-${arch}.zip`,
      `    sha512: ${arch === 'arm64' ? 'arm64-sha512' : 'x64-sha512'}`,
      `path: Craft-Agents-${arch}.zip`,
      `sha512: ${arch === 'arm64' ? 'arm64-sha512' : 'x64-sha512'}`,
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'),
  );
}

describe('macOS release configuration', () => {
  test('requires Developer ID signing and notarization for macOS release artifacts', () => {
    const builderConfig = readRepoFile('apps/electron/electron-builder.yml');

    expect(builderConfig).toContain('forceCodeSigning: true');
    expect(builderConfig).toContain('notarize: true');
    expect(builderConfig).toMatch(/target:\n\s+- dmg\n\s+- zip/);
  });

  test('injects Apple signing and notarization credentials into the release workflow', () => {
    const workflow = readRepoFile('.github/workflows/release.yml');

    expect(workflow).toContain('CRAFT_REQUIRE_MAC_SIGNING: "1"');
    expect(workflow).toContain('CSC_LINK: ${{ secrets.CSC_LINK }}');
    expect(workflow).toContain('CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}');
    expect(workflow).toContain('APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}');
    expect(workflow).toContain('APPLE_ID: ${{ secrets.APPLE_ID }}');
    expect(workflow).toContain('APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}');
    expect(workflow).toContain('APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}');
    expect(workflow).toContain('Annotate macOS update manifest');
    expect(workflow).toContain('${{ matrix.arch }}=$manifest');
    expect(workflow).toContain('latest-mac-${{ matrix.arch }}.yml');
    expect(workflow).toContain('Merge macOS update manifests');
    expect(workflow).toContain("gh release download \"$RELEASE_TAG\"");
    expect(workflow).toContain('scripts/merge-macos-update-manifests.py');
    expect(workflow).not.toContain('awk');
    expect(workflow).toContain("gh release upload \"$RELEASE_TAG\" latest-mac.yml --clobber");
    expect(existsSync(join(rootDir, 'scripts/merge-macos-update-manifests.py'))).toBe(true);
  });

  test('fails the macOS release build before upload if Gatekeeper verification fails', () => {
    const buildScript = readRepoFile('apps/electron/scripts/build-dmg.sh');
    const workflow = readRepoFile('.github/workflows/release.yml');

    expect(buildScript).toContain('validate_macos_release_credentials');
    expect(buildScript).toContain('verify_macos_release_artifacts');
    expect(buildScript).toContain('-c.mac.forceCodeSigning=true -c.mac.notarize=true');
    expect(buildScript).toContain('select_notarization_credentials');
    expect(buildScript).toContain('unset APPLE_ID');
    expect(buildScript).toContain('codesign --verify --deep --strict');
    expect(buildScript).toContain('spctl --assess');
    expect(buildScript).toContain('xcrun stapler validate');
    expect(buildScript).toContain('DMG artifact present');
    expect(buildScript).toContain('ZIP artifact present');
    expect(workflow).toContain('Verify macOS signing and notarization');
  });

  test('installer no longer documents Gatekeeper bypass as the expected macOS path', () => {
    const installScript = readRepoFile('scripts/install-app.sh');

    expect(installScript).not.toContain('Open Anyway');
    expect(installScript).not.toContain('temporary workaround for unsigned or non-notarized builds');
    expect(installScript).toContain('verify_macos_app_trust');
    expect(installScript.indexOf('verify_macos_app_trust "$app_source"')).toBeLessThan(
      installScript.indexOf('Removing previous installation'),
    );
  });

  test('macOS manifest helper annotates a single architecture manifest', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'craft-mac-manifest-'));
    const input = join(tempDir, 'latest-mac.yml');
    const output = join(tempDir, 'latest-mac-arm64.yml');
    writeMacManifest(input, 'arm64');

    const result = spawnSync(
      'python3',
      [join(rootDir, 'scripts/merge-macos-update-manifests.py'), output, `arm64=${input}`],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    const manifest = readFileSync(output, 'utf8');
    expect(manifest).toContain('  - url: Craft-Agents-arm64.zip');
    expect(manifest).toContain('    arch: arm64');
  });

  test('macOS manifest helper merges arm64 and x64 manifests', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'craft-mac-manifest-'));
    const arm64 = join(tempDir, 'latest-mac-arm64.yml');
    const x64 = join(tempDir, 'latest-mac-x64.yml');
    const output = join(tempDir, 'latest-mac.yml');
    writeMacManifest(arm64, 'arm64');
    writeMacManifest(x64, 'x64');

    const result = spawnSync(
      'python3',
      [
        join(rootDir, 'scripts/merge-macos-update-manifests.py'),
        output,
        `arm64=${arm64}`,
        `x64=${x64}`,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    const manifest = readFileSync(output, 'utf8');
    expect(manifest).toContain('  - url: Craft-Agents-arm64.zip');
    expect(manifest).toContain('    arch: arm64');
    expect(manifest).toContain('  - url: Craft-Agents-x64.zip');
    expect(manifest).toContain('    arch: x64');
    expect(manifest).toContain('path: Craft-Agents-arm64.zip');
  });
});
