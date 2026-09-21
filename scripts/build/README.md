# scripts/build

Shared and platform-specific helpers for packaging Electron and server release artifacts.

See `../env-loader.ts` for the shared local dotenv loading rules used by
TypeScript build/dev entrypoints.

## Files

- `common.ts` - shared build utilities for downloads, runtime staging, uploads, and verification.
- `darwin.ts` - macOS packaging helpers.
- `desktop-auth-build-config.ts` - validates packaged Electron client-auth broker settings.
- `desktop-trust-boundaries.test.ts` - guards desktop auth, telemetry, TLS, and production packaging boundaries.
- `environment-contract.test.ts` - regression tests for env-var lifecycle boundaries.
- `electron-package-size-config.test.ts` - tests real builder file selection and product locale coverage.
- `package-artifact.ts` / `.test.ts` - checks final app/archive contents, hashes, component sizes and reviewed budgets before publication.
- `package-size-budgets.json` - per-target byte ceilings; unapproved entries fail release verification.
- `attachment-package.isolated.ts` - real bundled PDF conversion and original-byte regression check.

- `electron-main-build-config.test.ts` - regression tests for Electron main process bundling constraints.
- `file-stability.test.ts` - checks shared build-output stabilization and timeout behavior.
- `linux.ts` - Linux packaging helpers.
- `macos-release-config.test.ts` - regression tests for signed/notarized macOS release configuration.
- `macos-keychain-password.test.ts` - verifies the installed signing dependency separates certificate and temporary keychain passwords without accessing a real keychain; see `../../patches/README.md`.
- `pi-agent-server.ts` - builds the self-contained Pi subprocess required by Pi's native Extension loader.
- `resource-staging.test.ts` - regression tests for Electron subprocess resource staging.
- `resource-staging.ts` - stages built subprocess bundles into Electron resources.
- `win32.ts` - Windows packaging helpers.
- `windows-git-installer.test.ts` - guards automatic Git for Windows provisioning in fresh NSIS installs.

Package acceptance and budget approval: [QA runbook](../../docs/package-size-qa.md).
