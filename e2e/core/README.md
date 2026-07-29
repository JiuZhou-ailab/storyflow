# Core Electron E2E
`run.ts` drives the built desktop app through its public preload API against a deterministic local model stub.
It covers local no-login startup, a real Pi `edit` tool turn, isolated workspace versions, restore, and restart recovery.
Run `bun run e2e:core`; set `CRAFT_E2E_ELECTRON_BIN` to a packaged app executable to test the release artifact.
