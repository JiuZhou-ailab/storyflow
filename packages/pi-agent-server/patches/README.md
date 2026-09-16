# Pi Dependency Patches

Version-pinned Bun patches for Pi 0.84.4. Upstream source:
[earendil-works/pi](https://github.com/earendil-works/pi). Tracking contract:
[Storyflow #41](https://github.com/JiuZhou-ailab/storyflow/issues/41).

On 2026-09-16 the published 0.85.1 `agent-session.js`/`utils/retry.js` still lacked
`Retry-After`, `x-should-retry` and `upstream_auth_failed` session handling. Keep
0.84.4 pinned; no application hook edits error messages to induce retries.

- `@earendil-works%2Fpi-ai@0.84.4.patch`: emit provider response hooks on rejected
  HTTP calls; refresh correlation headers for provider-internal transport retries;
  classify permanent gateway semantics before generic 5xx matching.
- `@earendil-works%2Fpi-coding-agent@0.84.4.patch`: preserve HTTP rejection semantics
  and honor Retry-After in the native abortable session backoff; forward refreshed
  retry headers; newer concurrent `setModel` calls win after auth awaits; preserve
  cancellation through awaited model selection, prompt preflight and retry events.

Google's SDK drops error response headers. Gateway failures also carry bounded
`retry_after_ms` metadata, consumed by the native Pi session backoff. Success SSE
remains untouched. No Host-owned sleep, request loop or payload rewriting exists.

Delete the patches when a supported Pi release passes
`bun test packages/pi-agent-server/src/managed-fallback.test.ts` **without** them.
That suite uses real Pi sessions against loopback HTTP across all four APIs;
removing the patches reproduces deterministic-denial amplification, early retry,
and repeated attempt=0. Do not remove a patch based only on SDK provider-level
retry support: the outer AgentSession has its own classifier and budget.

Bun applies patches from root `package.json` on install. Avoid stale package-local
`node_modules/@earendil-works` copies shadowing the root installation; verify module
resolution when testing a dependency upgrade.
