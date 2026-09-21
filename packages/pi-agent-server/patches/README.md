# Pi Dependency Patches

Version-pinned Bun patches for Pi 0.84.4. Upstream source:
[earendil-works/pi](https://github.com/earendil-works/pi). Tracking contract:
[Storyflow #41](https://github.com/JiuZhou-ailab/storyflow/issues/41).

On 2026-09-16 the published 0.85.1 `agent-session.js`/`utils/retry.js` still lacked
`Retry-After`, `x-should-retry` and `upstream_auth_failed` session handling. Keep
0.84.4 pinned; no application hook edits error messages to induce retries.

- `@earendil-works%2Fpi-ai@0.84.4.patch`: emit provider response hooks on rejected
  HTTP calls; refresh correlation headers for provider-internal transport retries;
  classify permanent gateway semantics before generic 5xx matching in both provider
  and session retries; honor bounded JSON retry metadata when SDK headers are lost.
- `@earendil-works%2Fpi-coding-agent@0.84.4.patch`: preserve HTTP rejection semantics
  and honor Retry-After in the native abortable session backoff; forward refreshed
  retry headers; newer concurrent `setModel` calls win after auth awaits; preserve
  cancellation through awaited model selection, prompt preflight and retry events.

Google's SDK drops error response headers. Gateway failures also carry bounded
`retry_after_ms` metadata, consumed by both native provider and session backoff. Session
backoff parses full JSON numbers, including exponent notation, and rejects delays
beyond the timer range rather than overflowing into an immediate retry. Success SSE
remains untouched. No Host-owned sleep, request loop or payload rewriting exists.

Delete the patches when a supported Pi release passes
`bun test packages/pi-agent-server/src/managed-fallback.test.ts packages/pi-agent-server/src/managed-access-contract.test.ts` **without** them.
That suite uses real Pi sessions against loopback HTTP across all four APIs;
removing the patches reproduces deterministic-denial amplification, early retry,
and repeated attempt=0. Do not remove a patch based only on SDK provider-level
retry support: the outer AgentSession has its own classifier and budget.

Bun applies patches from root `package.json` on install. Avoid stale package-local
`node_modules/@earendil-works` copies shadowing the root installation; verify module
resolution when testing a dependency upgrade.

## Long-task budgets (#43)

The coding-agent patch adds optional public `compaction.maxSummaryTokens` to
SettingsManager and native compaction preparation. Storyflow applies 8192 without
writing user settings. Reserve space no longer implicitly enlarges summary calls.
The ai patch makes explicit `maxTokens` cap the combined response in budget-based
thinking adapters; reasoning fits inside the cap instead of adding to it. Unset
native requests still use model capacity. Registered model declarations stay intact.

`AgentSession.maxOutputTokens` records that caller budget for native length recovery;
the product stream wrapper enforces the same cap. Reaching the caller budget is not
a recoverable context truncation, even when model capacity is larger. Anthropic and
Bedrock disable budget-based thinking when the final (possibly context-clamped)
ceiling cannot fit the 1,024-token thinking minimum plus the SDK's answer reserve.
Adaptive thinking is unchanged; the caller's output cap is never increased.

Remove these hunks when upstream exposes the same contracts and the real Provider
checks in `runtime-budgets.test.ts` and `managed-access-contract.test.ts` pass
without the patches, including Anthropic thinking and all four supported protocols.
Include `thinking-budget.test.ts` for the small-budget and context-clamped cases.
