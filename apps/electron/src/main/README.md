# apps/electron/src/main

Electron main-process shell: app startup, native windows, IPC registration, auth, updates, and runtime path setup.

## Files

- `auto-update.ts` - Electron updater integration.
- `browser-cdp.ts` - Chrome DevTools Protocol bridge for browser panes.
- `browser-pane-manager.ts` - Native browser-pane window manager.
- `chunked-rpc.ts` - Chunked RPC payload helper.
- `client-auth.ts` - Desktop client authentication service.
- `deep-link.ts` - Deep-link parsing and dispatch.
- `index.ts` - Main-process bootstrap.
- `logger.ts` - Main-process logging setup.
- `menu.ts` - Application menu setup.
- `network-proxy-utils.ts` - Proxy string parsing helpers.
- `network-proxy.ts` - Electron session proxy configuration.
- `notifications.ts` - Native notification and badge handling.
- `onboarding.ts` - Onboarding state helpers.
- `platform.ts` - Electron implementation of shared platform services.
- `power-manager.ts` - Power and sleep integration.
- `runtime-paths.ts` - Packaged/dev runtime resource path resolver.
- `shell-env.ts` - User shell environment loader.
- `startup-state.ts` - Startup window creation policy.
- `thumbnail-protocol.ts` - Custom thumbnail protocol.
- `window-manager.ts` - Native app window lifecycle.
- `window-state.ts` - Window state persistence.
