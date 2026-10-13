# apps/electron/src/main/handlers

Electron-only handler registration. RPC handlers stay on the local server. `ipcMain` registrars own the preload channels that used to live in `index.ts`.

## Files

- `index.ts` - Registers core plus GUI RPC handlers.
- `handler-deps.ts` - Dependency bag injected into RPC handlers.
- `system.ts` - Update, menu, notification, and badge RPC.
- `workspace.ts` - Workspace window RPC and remote connection.
- `browser.ts` - Browser pane RPC.
- `settings.ts` - Settings GUI RPC.
- `shell-ipc.ts` - Window identity, transport diagnostics, renderer crash, and message box.
- `client-auth-ipc.ts` - Account sign-in, verification, and sign-out.
- `market-ipc.ts` - Skills Market and MCP subregistry IPC.
- `feedback-ipc.ts` - Feedback submission IPC.
- `host-ipc.ts` - Workspace, transfer, relaunch, language, and loopback sync IPC. Registered only with a local Host.
