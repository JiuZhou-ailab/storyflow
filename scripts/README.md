# scripts

Build, validation, packaging, install, and local development entry scripts for the monorepo.

## Files

- `browser-tool.ts` - browser tool helper runner.
- `build.ts` - root Electron package build dispatcher.
- `build-server.ts` - standalone server distribution builder.
- `build-wa-worker.ts` - WhatsApp worker bundle builder.
- `build/` - shared and platform-specific Electron packaging helpers.
- `check-i18n-coverage.ts` - i18n literal coverage check.
- `check-i18n-parity.ts` - i18n locale parity check.
- `check-raw-sends.sh` - raw IPC send guard.
- `check-version.ts` - workspace package version consistency check.
- `docker-smoke-test.sh` - Docker distribution smoke test.
- `electron-build-main.ts` - Electron main-process and subprocess bundle builder.
- `electron-build-preload.ts` - Electron preload bundle builder.
- `electron-build-renderer.ts` - Electron renderer build runner.
- `electron-build-resources.ts` - Electron resources copy step.
- `electron-clean.ts` - Electron build artifact cleaner.
- `electron-dev.ts` - local Electron development runner.
- `generate-dev-cert.sh` - local certificate generator.
- `install-app.ps1` - Windows app installer.
- `install-app.sh` - Unix app installer.
- `install-server.sh` - server installer.
- `oss-sync.ts` - explicit placeholder for the unavailable OSS sync workflow.
- `release.ts` - release gate that runs version checks, CI validation, and packaging.
- `sort-locales.ts` - locale key sorter.
- `test-workflow-local.sh` - local workflow test helper.
