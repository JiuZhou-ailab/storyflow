# MCP runtime

Host-owned Source connections and proxy tools. Shared contracts remain in
`@craft-agent/shared/mcp`; tool schemas and Source capability/permission bindings
are preserved here.

- `mcp-pool.ts`: reconciles calls in order and connects independent MCP/API sources
  in parallel. Remote MCP failures are remembered per slug and exact config, with
  30-second exponential backoff capped at 10 minutes. Skipped failures remain in
  `sync()` results and the existing session debug log, including the original reason.
- `client.ts`: HTTP/stdio SDK transport and confirmed subprocess cleanup.
- `api-source-pool-client.ts`: in-process API server transport and cleanup.
- `index.ts`: runtime exports; `__tests__/`: local transport and permission coverage.

Each pool connection has a 60-second deadline covering initialization and tool
listing, allowing first-time npx downloads; backoff limits subsequent retries.
The constructor accepts `connectTimeoutMs` only for test injection. Failure/timeout
closes its transport; stdio shutdown additionally permits
SDK escalation (2 seconds before SIGTERM, 2 before SIGKILL) and a 1-second exit
confirmation. Failed cleanup retains client ownership for a later disconnect/retry.
Healthy sources publish tools as soon as ready, without waiting for slow sources.

Success, config/credential changes, removal, and explicit retries reset backoff.
`clearBackoff(slug)` also invalidates a pending attempt's eventual failure. Session
`source_test` and explicit activation reach it through Host callbacks; automatic
activation does not reset backoff. State is local to the session pool and is not
persisted. No timer makes background connection attempts: the next sync after the
backoff expires retries.

Acceptance: `bun test ./packages/server-core/src/mcp` exercises real local HTTP
failures, explicit session-tool retry, bounded backoff, parallel discovery, HTTP
cancellation, and stdio exit. It requires no external MCP credentials or service.
