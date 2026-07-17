# 0002. Two-stage GUI bootstrap: workspace shell before Agent runtime

Date: 2026-07-16

## Status

Accepted

## Context

The desktop process historically treated one global condition as “the app is ready”: RPC transport, every stored session, automation watchers, model refresh, and messaging gateways all had to initialize before Electron created a window. Startup therefore scaled with abandoned conversation history even though the writing workspace only needs workspace metadata and file RPCs.

The performance fixture made the coupling visible: opening a project from an already rendered hub took about 198 ms, while reaching the hub took about 5 seconds with 6,000 stored sessions. Optimizing the file tree could not remove that delay because the tree was not on the critical path.

## Decision

Split server startup into two explicit phases:

1. **Transport/workspace shell ready** — WebSocket RPC, workspace catalog, file operations, navigation, and window creation are available.
2. **Agent runtime ready** — SessionManager migrations and session discovery, automation watchers, model refresh, and messaging gateways are initialized.

Electron defers phase 2 until the renderer reports that a real product surface has committed and painted. Electron's `ready-to-show` is insufficient because it can fire for the static HTML shell before React is interactive. A bounded fallback preserves Agent availability if the renderer fails before sending the signal. Headless hosts remain eager and do not report bootstrap completion before phase 2.

Session-dependent RPC domains register through one initialization-gated RPC facade. Workspace and file RPCs stay outside that gate. Workspace switching must not create runtime side effects; SessionManager initialization owns watchers for existing workspaces, while workspace creation waits for runtime readiness before registering a new watcher.

## Consequences

- Project hub and writing files are usable independently of old conversation volume.
- Session, automation, model, OAuth, settings, and messaging requests issued early wait on one deterministic gate instead of racing partially initialized state.
- A background Agent runtime failure can be reported locally without replacing or blanking the file workspace.
- Global session discovery still has an absolute cost after first paint. Discovery yields between bounded batches so it cannot monopolize the main-process event loop; indexed discovery remains an option only if measured data later justifies it.
