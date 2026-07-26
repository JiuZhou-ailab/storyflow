# Electron Scripts

Electron-local build, resource staging, validation, and platform packaging hooks; root release orchestration remains under `scripts/build/`.

- `afterPack.cjs`: installs the precompiled macOS asset catalog after packaging.
- `build-dmg.sh`: legacy macOS package entrypoint.
- `build-linux.sh`: legacy Linux package entrypoint.
- `build-win.ps1`: legacy Windows package entrypoint.
- `copy-assets.ts`: stages subprocesses and copies runtime resources into `dist/`.
- `validate-assets.ts`: rejects incomplete Electron build and resource output.
