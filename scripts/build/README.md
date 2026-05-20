# scripts/build

Shared and platform-specific helpers for packaging Electron and server release artifacts.

## Files

- `common.ts` - shared build utilities for downloads, runtime staging, uploads, and verification.
- `darwin.ts` - macOS packaging helpers.
- `electron-main-build-config.test.ts` - regression tests for Electron main process bundling constraints.
- `linux.ts` - Linux packaging helpers.
- `macos-release-config.test.ts` - regression tests for signed/notarized macOS release configuration.
- `resource-staging.test.ts` - regression tests for Electron subprocess resource staging.
- `resource-staging.ts` - stages built subprocess bundles into Electron resources.
- `win32.ts` - Windows packaging helpers.
