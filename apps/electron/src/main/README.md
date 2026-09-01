# apps/electron/src/main

Electron main-process shell: app startup, native windows, IPC registration, auth, updates, and runtime path setup.

## Files

- `auto-update.ts` - Electron updater integration.
- `browser-cdp.ts` - Chrome DevTools Protocol bridge for browser panes.
- `browser-pane-manager.ts` - Native browser-pane window manager.
- `client-auth-broker.ts` - Bounded HTTPS auth-broker client and response validation.
- `client-auth.ts` - Desktop client authentication service.
- `client-auth-token-lifecycle.ts` - Managed model-token refresh lifecycle and concurrency coordinator.
- `client-auth-session-store.ts` - Encrypted desktop auth and Neon session persistence.
- `deep-link.ts` - Deep-link parsing and dispatch.
- `feedback.ts` - Feedback issue submission adapter.
- `index.ts` - Main-process bootstrap.
- `logger.ts` - Main-process logging setup.
- `managed-capability-broker.ts` - Loopback bridge from Storyflow login to scoped model access plus exact search and scrape operations for child processes.
- `menu.ts` - Application menu setup.
- `network-proxy.ts` - Electron session proxy configuration using shared proxy rules.
- `notifications.ts` - Native notification and badge handling.
- `platform.ts` - Electron implementation of shared platform services.
- `power-manager.ts` - Power and sleep integration.
- `quit-coordinator.ts` - Idempotent cleanup and updater-safe quit sequencing.
- `runtime-paths.ts` - Packaged/dev runtime resource path resolver.
- `shell-env.ts` - User shell environment loader.
- `skills-market-client.ts` - Authenticated Skill publication without renderer token exposure.
- `mcp-market-client.ts` - Read-only, parsed MCP subregistry discovery without contacting listed endpoints.
- `startup-state.ts` - Startup window and stable recovery-download policy.
- `thumbnail-protocol.ts` - Custom thumbnail protocol.
- `window-manager.ts` - Native app window lifecycle.
- `window-state.ts` - Window state persistence.
