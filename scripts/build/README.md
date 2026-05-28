# scripts/build

Shared and platform-specific helpers for packaging Electron and server release artifacts.

See `../env-loader.ts` for the shared local dotenv loading rules used by
TypeScript build/dev entrypoints.

## Files

- `common.ts` - shared build utilities for downloads, runtime staging, uploads, and verification.
- `darwin.ts` - macOS packaging helpers.
- `desktop-auth-build-config.ts` - validates packaged Electron client-auth broker settings.
- `environment-contract.test.ts` - regression tests for env-var lifecycle boundaries.
- `electron-package-size-config.test.ts` - regression tests for Electron package-size inputs.
- `electron-main-build-config.test.ts` - regression tests for Electron main process bundling constraints.
- `linux.ts` - Linux packaging helpers.
- `macos-release-config.test.ts` - regression tests for signed/notarized macOS release configuration.
- `resource-staging.test.ts` - regression tests for Electron subprocess resource staging.
- `resource-staging.ts` - stages built subprocess bundles into Electron resources.
- `win32.ts` - Windows packaging helpers.
