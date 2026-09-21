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

## Host startup ownership

`bootstrap/headless-start.ts` owns allocation rollback, deferred Agent readiness and a shared,
bounded stop operation. Configuration is validated before backup rotation or migration. An explicit
backup selection is restored only while holding the Host lease. A cleanup failure or timeout retains
ownership until process exit; hosts must exit rather than reuse an incompletely stopped instance.
RPC and HTTP handler Promises drain before the final Session flush and ownership release;
`webui/node-adapter.ts` preserves the HTTP handler Promise even after its client disconnects.

`bootstrap/server-lock.ts` reads legacy plain PIDs, v0.17 owner directories and v1 compatibility files.
New acquisitions publish a nonempty `.server.lease` directory by rename, containing one unique
`owner-<acquisitionId>.json`; `.server.lock` remains a JSON compatibility file (`leaseVersion: 2`).
OS process creation identity is separate from acquisition identity. Heartbeat age never proves death.
If the new process's birth query is unavailable, it may still acquire an unowned directory atomically.
Its live PID then remains unknown to peers; after a crash, PID reuse without birth metadata also fails closed.
Only a proven exited/reused owner is reclaimed; unknown or incomplete historical metadata fails closed.
Legacy live PIDs remain unknown: wall-clock timestamps cannot prove process reuse after clock changes.
Release removes only its own marker and uses nonrecursive rmdir, so a stale release cannot remove a
new nonempty generation. This local-filesystem protocol does not add network filesystem support.
Migration is forward on acquire; old readers remain excluded by the compatibility PID, and rollback
across a crash requires a current reader to recover v2 before launching a pre-v2 binary. Keep legacy
readers until the supported upgrade baseline no longer contains these released formats.

`bootstrap/tls.ts` rejects incomplete/invalid TLS settings and derives a reachable local endpoint.
The desktop trusts its explicitly configured certificate only on that connection, retaining hostname,
validity and key checks; remote clients keep independent trust.
See [startup QA](../../docs/startup-recovery-qa.md) for the actual acceptance commands and limitations.
