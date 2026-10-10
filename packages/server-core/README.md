# @craft-agent/server-core

Reusable WS/headless server infrastructure extracted from `apps/electron`.

## Scope

- WS RPC transport primitives (`server`, `codec`, `types`, `capabilities`)
- Runtime platform contracts (`PlatformServices`) and headless implementation
- Generic handler dependency contracts
- Reusable headless bootstrap orchestration, including deferred Free Conversation storage migration under the exclusive Host lease
- Session lifecycle orchestration and its runtime state/persistence projections
- Authenticated model catalog synchronization: an empty success replaces cached models; fetch failures preserve them; local retirement and display-name policy also applies to stored and refreshed catalogs; identity replacement refreshes independently of pending old-account requests
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

`bootstrap/server-lock.ts` reads legacy plain PIDs, v0.17 owner directories and v1/v2 compatibility files.
New acquisitions publish a nonempty `.server.lease` directory by rename, containing one unique
`owner-<acquisitionId>.json`; `.server.lock` remains a JSON compatibility file (`leaseVersion: 3`).
Liveness is OS-held: before publishing, each acquisition listens on its own endpoint (Windows named
pipe `storyflow-host-<acquisitionId>`, POSIX `.host-<id>.sock` in the data directory) and records it
as `livenessEndpoint`. A connection proves the owner is running, independent of PID reuse or OS
identity queries. On Windows only ENOENT proves exit (busy, access-denied or timed-out pipes are live).
On POSIX ECONNREFUSED proves exit unless the recorded creation identity still matches (a full backlog
also refuses); ENOENT (socket file removed) falls back to identity. Heartbeat age never proves death.
Owners without an endpoint (older versions, or a failed listen / overlong POSIX path) fall back to
OS process creation identity; unknown or incomplete metadata fails closed as `OWNER_UNKNOWN`.
Legacy live PIDs remain unknown: wall-clock timestamps cannot prove process reuse after clock changes.
The only exit from `OWNER_UNKNOWN` is a user-confirmed one-shot override (`overrideUnverifiedOwner`,
Electron `--override-unverified-host-owner`; headless has none yet); a provably live owner still wins
(`OWNER_ACTIVE`). Under override, unrecognized lease/compatibility state (e.g. a torn marker) is renamed
to `<name>.unrecognized-<ms>`, never deleted. A lease seen mid-release and transient rename failures
retry with bounded backoff; persistent filesystem refusals surface as their own error. The ownership
monitor tolerates brief unreadability but exits on definitive marker loss.
Release removes only its own marker and uses nonrecursive rmdir, so a stale release cannot remove a
new nonempty generation; the endpoint closes only after the marker is gone (otherwise at exit). This local-filesystem protocol does not add
network filesystem support. Migration is forward on acquire; v2 readers ignore the endpoint and keep
using process identity, and old readers remain excluded by the compatibility PID. Keep legacy
readers until the supported upgrade baseline no longer contains these released formats.

`bootstrap/tls.ts` rejects incomplete/invalid TLS settings and derives a reachable local endpoint.
The desktop trusts its explicitly configured certificate only on that connection, retaining hostname,
validity and key checks; remote clients keep independent trust.
See [startup QA](../../docs/startup-recovery-qa.md) for the actual acceptance commands and limitations.

## Interactive text documents

The file RPC includes versioned text reads/saves and recovery access. `text-document` validates Project or Session ownership, keeps attachments immutable, preserves supported UTF-8 BOM and newline conventions, rejects stale versions, and retains observed pre-save/submitted bytes before replacement. Save As creates a new target exclusively. Recovery records remain in internal workspace/session storage and are not conversation content. The serialization boundary covers these editor saves only; external filesystem writers do not participate. Legacy file writes retain their existing contract.
