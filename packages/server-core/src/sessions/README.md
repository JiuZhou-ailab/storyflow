# Sessions

`SessionManager.ts` is the Product Host session Facade: it implements `ISessionManager` (handlers/session-manager-interface.ts) as one-line delegates, and keeps only the cross-cutting orchestration that changes for reasons of its own — sendMessage/processEvent projection, rewind, Project transition/operation draining, configWatcher/automations glue, session create/delete, permission/question responders.

Modules by reason-of-change (all flat in this directory):

| Module | Owns |
| --- | --- |
| `session-broadcaster.ts` | Event sink fan-out: sendEvent, broadcast*, delta batching |
| `share-service.ts` | revokeShare for legacy third-party shares (creating shares is removed) |
| `message-edits.ts` | Message annotation add/update/remove + updateMessageContent |
| `plan-tracking.ts` | Pending plan execution state (five plain functions over ManagedSession) |
| `session-crud-metadata.ts` | Flag/archive/status/connection/rename/model/labels/thinking/read-state/viewing-session metadata |
| `auth-flow.ts` | reinitializeAuth, completeAuthRequest, credential input handling |
| `export-import.ts` | Session export/import incl. remote transfer payloads |
| `persistence.ts` | Boot/init gate, disk load, debounced persist queue, lazy message load, idle release |
| `session-init.bench.ts` | Local fresh-process restoration benchmark and FS/JSON/build/yield diagnostics for the 6000-Session fixture |
| `agent-runtime-lease.ts` | Per-session send-admission gates, runtime mutex, and shared-subprocess lease counting |
| `isolated-test-runner.ts` | Shared Bun subprocess + marked JSON parsing for lifecycle tests |
| `agent-runtime.ts` | Pi subprocess lifecycle: getOrCreateAgentLocked, runtime refresh, three eligible idle runtimes, credential rotation, confirmed disposal; AGENT_FLAGS |
| `wire-agent-callbacks.ts` | Post-construction product callback wiring onto a live agent |
| `browser-pane-bridge.ts` | browser_* tool delegation to BrowserPaneManager |
| `source-bridge.ts` | buildServersFromSources shared by source reload paths (bridge updates call `agent.applyBridgeUpdates(...)` directly) |

Pre-existing support modules: `managed-session.ts` (ManagedSession state assembly), `runtime-config.ts` (runtime/restart signatures), `pi-turn-anchors.ts` (provider fork anchors), `tool-display.ts` (UI tool projection), `turn-watchdog.ts` (absolute turn safety limit), `managed-gateway-auth-error.ts`, `write-original-content.ts`, `session-runtime.ts` (host singletons + pure helpers incl. getLastFinalOutputMessageId).

Module wiring rule: stateful modules receive a narrow deps object of arrow functions resolving through the Facade (`this`) at call time, so per-instance test stubs on SessionManager keep working; stateless helpers are plain functions taking `ManagedSession` directly. Adjacent `*.test.ts` files verify these boundaries and durable session behavior.

The published `queryOnce` RPC remains success-or-error: failed, cancelled and incomplete Pi results reject before any legacy consumer can use partial text as a rewrite. Successful results pass through unchanged, including older runtime responses without a status field.

Automatic Session cleanup uses the `deleteIfEmpty` Session command. The Host checks loaded messages and active operations atomically with the deletion tombstone under the Project lock; cold or busy Sessions are retained. Explicit user deletion remains separate. Clients never fall back to unconditional deletion when an older server rejects the new command. Send acknowledgement loss is an unknown outcome, not permission to delete or replay the request.

Permission responses must match a pending request owned by the live Session and still awaited by Pi. The explicit `permissionMode: 'allow-all'` response option uses the same metadata mutation as the mode selector before resuming Pi's native `tool_call` hook; this updates the runtime, broadcasts the mode, and persists its metadata. Project execute consent remains process-scoped: writable Session metadata does not restore authorization after restart. Single-tool and administrator approvals do not implicitly change Session mode.

Pending user questions retain their complete requests beside their live resolvers. Session list and detail snapshots expose these requests so clients can recover after reload, project switching, or missed events. Answer and cancellation broadcast `user_question_resolved` by request ID to every workspace client. This state is process-scoped and is never restored from disk without a live waiter.

Standalone scheduled tasks live in the free-conversation runtime and start at Host boot even when no Project is registered. Matcher `sessionId` binds runs to a persisted conversation; dispatch retains its model and permissions, uses the normal send queue, and rejects unavailable targets without creating replacements. Legacy matchers without a binding continue creating per-run sessions.

Every send serializes its short admission phase per Session: loading, queue selection, persistence, and claiming the processing generation. The gate releases before model execution, so concurrent sends durably queue rather than overwrite the active turn. Bound automation validation hands off synchronously to the send's own operation lease; validation never retains a lease while cold runtime acquisition waits for active operations to drain.

Session titles derive from the user-visible request: context badges and edit instructions do not enter first-title inference. The full original message remains unchanged in the transcript; explicit title refresh also strips edit metadata.

Idle runtime residency is independent of the transcript cache. Operation drain and native Pi settlement trigger an opportunistic sweep, keeping the three most recently used eligible runtimes. Active leases/admission, native prompts or pending requests, queued sends, permission/auth interactions, background work, and closing Sessions are exempt. The existing per-Session mutex protects the final eligibility check, durable flush, and disposal; sweeps never wait behind user operations or trigger themselves on failure. Cleanup failures retain their original runtime/MCP owners and block replacement until the same cleanup succeeds. Native history is restored through the existing Pi creation path, without replaying the user request.

Question snapshots and request/resolved events carry a Host epoch and monotonic sequence. Renderers reject older snapshots within the same epoch; a restarted Host supplies a new epoch.

Host shutdown uses `SessionManager.shutdown(requestsDrained)` to close runtime and Project admission, await existing Pi disposal and runtime leases, stop automations/watchers, join accepted requests, and then snapshot deferred writes and flush durable state. Only writes deferred in the shutdown's own runtime epoch are snapshotted; untouched history stays cold. Existing delete/Project transitions keep their own final-write policy, and changed cold snapshots hydrate passively without starting queued work. Snapshot failures do not prevent healthy Sessions from flushing. Late requests cannot create another runtime or restart watchers. The shared bootstrap retains ownership when that work fails or exceeds the stop deadline. This composes the existing Pi real-exit contract; it does not replay messages or implement another Agent runtime.

## Local restoration benchmark

Run from the repository root against an isolated copy of the standard 20-Project,
6000-Session fixture (rebase its persisted root paths to the copy):

```sh
CRAFT_CONFIG_DIR=/tmp/perf/sessinit-fixture /tmp/perf/bench-lock.sh \
  bun packages/server-core/src/sessions/session-init.bench.ts
```

Each of the default 10 samples uses a fresh Bun process and times
`SessionPersistence.loadSessionsFromDisk`, excluding imports and boot-service
setup. Every sample asserts 6000 restored Sessions, cold transcripts, and the
active Project's readiness before background Projects. OS file caches are not
purged. `SESSINIT_RUNS` changes the sample count; `SESSINIT_PROFILE=1` enables
separate diagnostic FS, JSON, construction and yield timings. Async FS durations
include scheduling waits and overlap across the existing 32-wide batches; their
sums are not additive wall time. Diagnostic instrumentation is absent from the
production path and must not be enabled for acceptance timings.

For historical comparison, export the baseline `packages/shared/src/sessions/storage.ts`
with `git show` and pass its absolute path as `SESSINIT_BASELINE_STORAGE`. The
probe verifies that this source was loaded, without changing the checkout.
Alternate baseline/current `--worker` invocations under one benchmark lock.

2026-10-13, Bun 1.4.2, baseline `f369803b9`, same fixture, 10 interleaved pairs;
percentiles use linear interpolation:

| Boundary (ms) | Before P50 / P95 | After P50 / P95 |
| --- | --- | --- |
| All Session metadata restored | 4361.70 / 4776.91 | 3815.96 / 3985.46 |
| Active Project ready | 229.58 / 279.19 | 201.84 / 211.18 |

All 10 pairs improved at both boundaries. The healthy-file recovery path avoids
ancestor traversal for absent `.tmp`/`.bak` candidates: per 6000 Sessions,
`realpathSync` calls fall from 330258 to 282258 and `lstatSync` from 480395 to
420395. Existing candidates, including dangling symlinks, retain the full path
guard; candidate selection and the writer's backup/rename ownership are unchanged.
This measures disk restoration, not complete Electron startup or runtime readiness.

Baseline diagnostic medians (3 separate instrumented runs, cumulative call times):

| Component | Calls per run | Median ms |
| --- | ---: | ---: |
| `realpathSync` / `lstatSync` / `statSync` | 330258 / 480395 / 24020 | 2895.53 / 532.37 / 43.76 |
| Async directory listing / sync file reads | 20 / 24064 | 3.78 / 352.29 |
| Header open / read / close (overlapping awaits) | 6000 each | 15952.87 / 2126.80 / 45793.04 |
| JSON parsing, including config reads | 30063 | 245.62 |
| ManagedSession construction / explicit yields | 6000 / 81 | 11.61 / 3.51 |

Construction costs about 1.93 microseconds per Session. Async header latencies
include other callbacks running before their promises resume; do not sum them
or interpret them as kernel I/O service time. Host-load variation also affects
instrumented timings; the interleaved, uninstrumented pairs above are the
acceptance evidence. Raw local reports: `/tmp/perf/sessinit-paired.json` and
`/tmp/perf/sessinit-profile-{before,after}.json`.
