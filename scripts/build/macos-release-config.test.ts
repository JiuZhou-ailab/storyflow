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
    expect(builderConfig).toContain('sign: true');
    expect(builderConfig).toMatch(/target:\n\s+- dmg\n\s+- zip/);
  });

  test('injects Apple signing, notarization, and R2 credentials into the release workflow', () => {
    const workflow = readRepoFile('.github/workflows/release.yml');

    expect(workflow).toContain('preflight-release-secrets:');
    expect(workflow).toContain('Verify release secrets');
    expect(workflow).toContain('Missing CSC_LINK');
    expect(workflow).toContain('Missing Apple notarization credentials');
    expect(workflow).toContain(
      'for name in STORYFLOW_R2_BUCKET CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID',
    );
    expect(workflow).toContain('missing+=("Missing $name")');
    expect(workflow).toMatch(/create-release:\n\s+needs:\n\s+- validate\n\s+- preflight-release-secrets/);
    expect(workflow).toContain('CRAFT_REQUIRE_MAC_SIGNING: "1"');
    expect(workflow).toContain('timeout-minutes: 360');
    expect(workflow).toContain('CSC_LINK: ${{ secrets.CSC_LINK }}');
    expect(workflow).toContain('CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}');
    expect(workflow).toContain('APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}');
    expect(workflow).toContain('APPLE_ID: ${{ secrets.APPLE_ID }}');
    expect(workflow).toContain('APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}');
    expect(workflow).toContain('APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}');
    expect(workflow).toContain('if [ -n "$APPLE_API_KEY_BASE64" ] && [ -n "$APPLE_API_KEY_ID" ]; then');
    expect(workflow).toContain('APPLE_API_ISSUER is optional and should be omitted for Individual API keys');
    expect(workflow).toContain('CRAFT_MACOS_NOTARIZE_ATTEMPTS: "3"');
    expect(workflow).toContain('CRAFT_MACOS_NOTARIZE_RETRY_DELAY_SECONDS: "60"');
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(workflow).toContain('CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}');
    expect(workflow).not.toContain('STORYFLOW_R2_ACCESS_KEY_ID');
    expect(workflow).toContain('Publish release assets to Cloudflare R2');
    expect(workflow).toContain('bun run release:upload-r2');
    expect(workflow).toContain('deploy-marketing:');
    expect(workflow).toMatch(/deploy-marketing:\n\s+needs: publish-r2/);
    expect(workflow).toContain('Build marketing site');
    expect(workflow).toContain('bun run marketing:build');
    expect(workflow).toContain('Deploy marketing site to Cloudflare Pages');
    expect(workflow).toContain('Skip marketing deploy without Pages token');
    expect(workflow).toContain('CLOUDFLARE_PAGES_API_TOKEN: ${{ secrets.CLOUDFLARE_PAGES_API_TOKEN }}');
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_PAGES_API_TOKEN }}');
    expect(workflow).toContain('bunx wrangler pages deploy apps/marketing/dist');
    expect(workflow).toContain("STORYFLOW_PAGES_PROJECT_NAME: ${{ vars.STORYFLOW_PAGES_PROJECT_NAME || 'storyflow' }}");
    expect(workflow).toContain("if [ -z \"$CLOUDFLARE_PAGES_API_TOKEN\" ]; then");
    expect(workflow).toContain("if [ -n \"$CLOUDFLARE_PAGES_API_TOKEN\" ]; then");
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

  test('official release workflow validates versions and never builds Windows with dev runtime', () => {
    const workflow = readRepoFile('.github/workflows/release.yml');

    expect(workflow).toContain('bun run check-version');
    expect(workflow).toContain('run: bun run electron:dist:win');
    expect(workflow).not.toContain('run: bun run electron:dist:dev:win');
  });

  test('macOS release build can skip duplicate dependency install after CI install', () => {
    const buildScript = readRepoFile('apps/electron/scripts/build-dmg.sh');
    const workflow = readRepoFile('.github/workflows/release.yml');

    expect(buildScript).toContain('CRAFT_SKIP_INSTALL');
    expect(buildScript).toContain('bun install --frozen-lockfile');
    expect(workflow).toContain('CRAFT_SKIP_INSTALL: "1"');
  });

  test('publishes updater manifests from the public R2 endpoint', () => {
    const builderConfig = readRepoFile('apps/electron/electron-builder.yml');
    const autoUpdate = readRepoFile('apps/electron/src/main/auto-update.ts');
    const installScript = readRepoFile('scripts/install-app.sh');
    const windowsInstallScript = readRepoFile('scripts/install-app.ps1');

    expect(builderConfig).toContain('provider: generic');
    expect(builderConfig).toContain('url: https://story-storage.zjding.com/latest');
    expect(autoUpdate).toContain('public R2 download');
    expect(installScript).toContain(
      'RELEASE_DOWNLOAD_URL="${STORYFLOW_DOWNLOAD_BASE_URL:-https://story-storage.zjding.com/latest}"',
    );
    expect(windowsInstallScript).toContain('https://story-storage.zjding.com/latest');
    expect(builderConfig).not.toContain('craft-agents-oss/releases/latest/download');
    expect(installScript).not.toContain('craft-agents-oss/releases/latest/download');
  });

  test('fails the official macOS release build before upload if Gatekeeper verification fails', () => {
    const buildScript = readRepoFile('apps/electron/scripts/build-dmg.sh');
    const workflow = readRepoFile('.github/workflows/release.yml');

    expect(buildScript).toContain('validate_macos_release_credentials');
    expect(buildScript).toContain('normalize_csc_link_for_macos_security');
    expect(buildScript).toContain('Normalized CSC_LINK for macOS keychain import.');
    expect(buildScript).toContain('pkcs12 -legacy');
    expect(buildScript).toContain('local export_openssl="/usr/bin/openssl"');
    expect(buildScript).toContain('notarize_macos_dmg_artifact');
    expect(buildScript).toContain('verify_macos_release_artifacts');
    expect(buildScript).toContain('run_electron_builder_with_retries');
    expect(buildScript).toContain('Apple notarization can return transient timeouts');
    expect(buildScript).toContain('npx electron-builder $BUILDER_ARGS');
    expect(buildScript).toContain('status=$?');
    expect(buildScript).not.toContain('if npx electron-builder $BUILDER_ARGS; then');
    expect(buildScript).toContain('-c.mac.forceCodeSigning=true -c.mac.notarize=true');
    expect(buildScript).toContain('select_notarization_credentials');
    expect(buildScript).toContain('APPLE_API_ISSUER is optional and must be omitted for Individual API keys');
    expect(buildScript).toContain('[ -n "${APPLE_API_KEY_BASE64:-}" ] || [ -n "${APPLE_API_KEY:-}" ]');
    expect(buildScript).toContain('unset APPLE_ID');
    expect(buildScript).toContain('codesign --verify --deep --strict');
    expect(buildScript).toContain('spctl --assess');
    expect(buildScript).toContain('xcrun notarytool submit "$dmg_path" --wait');
    expect(buildScript).toContain('xcrun stapler staple "$dmg_path"');
    expect(buildScript).toContain('spctl --assess --type open --context context:primary-signature');
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

  test('macOS build keeps explicit environment values ahead of local dotenv values', () => {
    const buildScript = readRepoFile('apps/electron/scripts/build-dmg.sh');

    expect(buildScript).toContain('[ -z "${!key+x}" ]');
    expect(buildScript).toContain('current_value="${!key}"');
    expect(buildScript).toContain('resolve_dotenv_value "$value"');
    expect(buildScript).toContain('resolve_dotenv_value "$current_value"');
    expect(buildScript).toContain('[ "${value:0:5}" = \'(cat \' ]');
    expect(buildScript).toContain('[ "${current_value:0:5}" = \'(cat \' ]');
    expect(buildScript).toContain('CSC_KEY_PASSWORD="$(cat /path/to/password)"');
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
