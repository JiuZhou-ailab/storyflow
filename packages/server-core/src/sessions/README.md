# Sessions

`SessionManager.ts` is the Product Host session Facade: it implements `ISessionManager` (handlers/session-manager-interface.ts) as one-line delegates, and keeps only the cross-cutting orchestration that changes for reasons of its own — sendMessage/processEvent projection, rewind, configWatcher/automations glue, session create/delete, permission/question responders.

Modules by reason-of-change (all flat in this directory):

| Module | Owns |
| --- | --- |
| `session-broadcaster.ts` | Event sink fan-out: sendEvent, broadcast*, delta batching |
| `share-service.ts` | shareToViewer / updateShare / revokeShare |
| `message-edits.ts` | Message annotation add/update/remove + updateMessageContent |
| `plan-tracking.ts` | Pending plan execution state (five plain functions over ManagedSession) |
| `session-crud-metadata.ts` | Flag/archive/status/connection/rename/model/labels/thinking/read-state/viewing-session metadata |
| `auth-flow.ts` | reinitializeAuth, completeAuthRequest, credential input handling |
| `export-import.ts` | Session export/import incl. remote transfer payloads |
| `persistence.ts` | Boot/init gate, disk load, debounced persist queue, lazy message load, idle release |
| `agent-runtime-lease.ts` | Per-session runtime mutex + shared-subprocess lease counting |
| `agent-runtime.ts` | Pi subprocess lifecycle: getOrCreateAgentLocked, runtime refresh, credential rotation, connection-scoped disposal; AGENT_FLAGS |
| `wire-agent-callbacks.ts` | Post-construction product callback wiring onto a live agent |
| `browser-pane-bridge.ts` | browser_* tool delegation to BrowserPaneManager |
| `source-bridge.ts` | buildServersFromSources shared by source reload paths (bridge updates call `agent.applyBridgeUpdates(...)` directly) |

Pre-existing support modules: `managed-session.ts` (ManagedSession state assembly), `runtime-config.ts` (runtime/restart signatures), `pi-turn-anchors.ts` (provider fork anchors), `tool-display.ts` (UI tool projection), `turn-watchdog.ts` (absolute turn safety limit), `managed-gateway-auth-error.ts`, `write-original-content.ts`, `session-runtime.ts` (host singletons + pure helpers incl. getLastFinalOutputMessageId).

Module wiring rule: stateful modules receive a narrow deps object of arrow functions resolving through the Facade (`this`) at call time, so per-instance test stubs on SessionManager keep working; stateless helpers are plain functions taking `ManagedSession` directly. Adjacent `*.test.ts` files verify these boundaries and durable session behavior.
