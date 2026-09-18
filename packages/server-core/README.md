# @craft-agent/server-core

Reusable WS/headless server infrastructure extracted from `apps/electron`.

## Scope

- WS RPC transport primitives (`server`, `codec`, `types`, `capabilities`)
- Runtime platform contracts (`PlatformServices`) and headless implementation
- Generic handler dependency contracts
- Reusable headless bootstrap orchestration
- Session lifecycle orchestration and its runtime state/persistence projections
- Authenticated model catalog synchronization: an empty success replaces cached models; fetch failures preserve them; identity replacement refreshes independently of pending old-account requests
- Session file RPCs with a bounded conversation-content projection and independent per-client file-watch consumers

## Out of scope

- Electron UI/main-process window management
- Renderer channel maps and generated client API wrappers

Those remain in `apps/electron` and are injected into bootstrap at runtime.
