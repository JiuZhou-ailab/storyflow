// input: macOS release workflow and Electron builder configuration
// output: Regression coverage that Storyflow macOS releases are signed, notarized, and updateable
// pos: Release safety guard preventing unsigned or non-updateable macOS artifacts from being published

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
      'version: 0.9.12',
      'files:',
      `  - url: Storyflow-${arch}.zip`,
      `    sha512: ${arch === 'arm64' ? 'arm64-sha512' : 'x64-sha512'}`,
      `    size: ${arch === 'arm64' ? '1234' : '5678'}`,
      `path: Storyflow-${arch}.zip`,
      `sha512: ${arch === 'arm64' ? 'arm64-sha512' : 'x64-sha512'}`,
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'),
  );
}

describe('macOS release configuration', () => {
  test('requires Developer ID signing and notarization for official macOS release artifacts', () => {
    const builderConfig = readRepoFile('apps/electron/electron-builder.yml');

    expect(builderConfig).toContain('forceCodeSigning: true');
    expect(builderConfig).toContain('notarize: true');
    expect(builderConfig).toMatch(/target:\n\s+- dmg\n\s+- zip/);
  });

  test('injects Apple signing, notarization, and R2 credentials into the release workflow', () => {
    const workflow = readRepoFile('.github/workflows/release.yml');

    expect(workflow).toContain('preflight-release-secrets:');
    expect(workflow).toContain('Verify release secrets');
    expect(workflow).toContain('Missing CSC_LINK');
    expect(workflow).toContain('Missing Apple notarization credentials');
    expect(workflow).toContain(
      'for name in STORYFLOW_R2_BUCKET STORYFLOW_R2_ENDPOINT STORYFLOW_R2_ACCESS_KEY_ID STORYFLOW_R2_SECRET_ACCESS_KEY',
    );
    expect(workflow).toContain('missing+=("Missing $name")');
    expect(workflow).toMatch(/create-release:\n\s+needs:\n\s+- validate\n\s+- preflight-release-secrets/);
    expect(workflow).toContain('CRAFT_REQUIRE_MAC_SIGNING: "1"');
    expect(workflow).toContain('CSC_LINK: ${{ secrets.CSC_LINK }}');
    expect(workflow).toContain('CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}');
    expect(workflow).toContain('APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}');
    expect(workflow).toContain('APPLE_ID: ${{ secrets.APPLE_ID }}');
    expect(workflow).toContain('APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}');
    expect(workflow).toContain('APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}');
    expect(workflow).toContain('STORYFLOW_R2_ENDPOINT: ${{ secrets.STORYFLOW_R2_ENDPOINT }}');
    expect(workflow).toContain('Publish release assets to Cloudflare R2');
    expect(workflow).toContain('bun run release:upload-r2');
    expect(workflow).toContain('Annotate macOS update manifest');
    expect(workflow).toContain('${{ matrix.arch }}=$manifest');
    expect(workflow).toContain('latest-mac-${{ matrix.arch }}.yml');
    expect(workflow).not.toContain('files+=(apps/electron/release/latest-mac.yml)');
    expect(workflow).toContain('Merge macOS update manifests');
    expect(workflow).toContain("gh release download \"$RELEASE_TAG\"");
    expect(workflow).toContain('scripts/merge-macos-update-manifests.py');
    expect(workflow).not.toContain('awk');
    expect(workflow).toContain("gh release upload \"$RELEASE_TAG\" latest-mac.yml --clobber");
    expect(workflow).toContain("grep -E '^Storyflow-arm64\\.dmg$'");
    expect(workflow).toContain("grep -E '^Storyflow-x64\\.dmg$'");
    expect(workflow).toContain("grep -E '^Storyflow-arm64\\.zip$'");
    expect(workflow).toContain("grep -E '^Storyflow-x64\\.zip$'");
    expect(existsSync(join(rootDir, 'scripts/merge-macos-update-manifests.py'))).toBe(true);
    expect(existsSync(join(rootDir, 'scripts/upload-r2-release-assets.ts'))).toBe(true);
  });

  test('publishes updater manifests from the public R2 endpoint', () => {
    const builderConfig = readRepoFile('apps/electron/electron-builder.yml');
    const autoUpdate = readRepoFile('apps/electron/src/main/auto-update.ts');
    const installScript = readRepoFile('scripts/install-app.sh');
    const windowsInstallScript = readRepoFile('scripts/install-app.ps1');

    expect(builderConfig).toContain('provider: generic');
    expect(builderConfig).toContain('url: https://download.storyflow.ai/latest');
    expect(autoUpdate).toContain('public R2 download');
    expect(installScript).toContain(
      'RELEASE_DOWNLOAD_URL="${STORYFLOW_DOWNLOAD_BASE_URL:-https://download.storyflow.ai/latest}"',
    );
    expect(windowsInstallScript).toContain('https://download.storyflow.ai/latest');
    expect(builderConfig).not.toContain('craft-agents-oss/releases/latest/download');
    expect(installScript).not.toContain('craft-agents-oss/releases/latest/download');
  });

  test('fails the official macOS release build before upload if Gatekeeper verification fails', () => {
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
    expect(buildScript).toContain('Storyflow.app');
    expect(workflow).toContain('Verify macOS signing and notarization');
  });

  test('installer verifies macOS trust and uses zip artifacts for app replacement', () => {
    const installScript = readRepoFile('scripts/install-app.sh');

    expect(installScript).not.toContain('Open Anyway');
    expect(installScript).not.toContain('temporary workaround for unsigned or non-notarized builds');
    expect(installScript).toContain('verify_macos_app_trust');
    expect(installScript).toContain('staged_app="$install_temp_dir/$APP_NAME"');
    expect(installScript).toContain('backup_app="$backup_temp_dir/$APP_NAME"');
    expect(installScript).toContain('mv "$INSTALL_DIR/$APP_NAME" "$backup_app"');
    expect(installScript).toContain('mv "$staged_app" "$INSTALL_DIR/$APP_NAME"');
    expect(installScript).toContain('mv "$backup_app" "$INSTALL_DIR/$APP_NAME"');
    expect(installScript).toContain('endswith(\\".zip\\")');
    expect(installScript).toContain('Expected exactly one .zip artifact for architecture');
    expect(installScript.indexOf('verify_macos_app_trust "$app_source"')).toBeLessThan(
      installScript.indexOf('Removing previous installation'),
    );
    expect(installScript.indexOf('staged_app="$install_temp_dir/$APP_NAME"')).toBeLessThan(
      installScript.indexOf('Removing previous installation'),
    );
  });

  test('macOS manifest helper annotates a single architecture manifest', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'storyflow-mac-manifest-'));
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
    expect(manifest).toContain('  - url: Storyflow-arm64.zip');
    expect(manifest).toContain('    arch: arm64');
    expect(manifest).toContain('    size: 1234');
  });

  test('macOS manifest helper merges arm64 and x64 manifests', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'storyflow-mac-manifest-'));
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
    expect(manifest).toContain('  - url: Storyflow-arm64.zip');
    expect(manifest).toContain('    arch: arm64');
    expect(manifest).toContain('    size: 1234');
    expect(manifest).toContain('  - url: Storyflow-x64.zip');
    expect(manifest).toContain('    arch: x64');
    expect(manifest).toContain('    size: 5678');
    expect(manifest).toContain('path: Storyflow-arm64.zip');
  });
});
