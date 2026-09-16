# Managed model fallback QA (Spec #41)

No paid provider is required. Keep production credentials and user settings out of
these fixtures. Runtime acceptance uses real Pi AgentSession instances against
loopback HTTP; only the external provider response and clock are controlled.

Candidate activation is currently pending capability confirmation. The managed
catalog has no explicit `fallbackCapabilities` declarations, so production
selection fails closed with `fallback_unavailable/no_compatible_candidate`.
The synthetic SDK `maxTokens: 8192` is only a request default. Qualified entries
must explicitly declare their output limit, tool support and the existing
prompt-based JSON schema contract; this does not claim native strict-schema
support. Local fixtures declare these capabilities for their controlled server.

## Automated checks

```sh
bun test packages/pi-agent-server/src/managed-fallback.test.ts
bun test apps/model-gateway-worker/src/index.test.ts apps/model-gateway-worker/src/upstream-error.test.ts
bun test packages/pi-agent-server/src/provider-hooks.test.ts packages/pi-agent-server/src/subagent-tool.test.ts packages/pi-agent-server/src/pi-sdk-boundary.test.ts
bun run typecheck:all
```

The runtime suite verifies all four native protocols; A,A,B recovery; shared retry
budget; permanent rejection; Retry-After/cancel; partial text/reasoning/tool args;
exactly-once committed tool results; cooldown through resource reload; lazy recovery;
manual selection races; independent parent/two subagents/mini-query state; actual
model persistence; legacy history; fixed mini-model and custom-provider exclusion.

A Model Call ID is stable across its retries and model substitution. A successful
tool-use assistant message closes it; the next generation gets a new ID. Request
headers use correlation version 2, separate Pi retry index and transport attempt.
Provider-internal retries also increment transport attempt. Missing legacy fields
remain unknown. HTTP `phase: headers` is not generation completion; use Pi
`model_stream_end.outcome` and `stop_reason`. Unknown cost is logged as null.

## Renderer QA

1. Run `bun run --cwd apps/electron dev --host 127.0.0.1 --port 5189` and open
   `http://127.0.0.1:5189/playground.html`. Choose **Settings → Managed Fallback**.
2. Confirm default switch on, exactly one localized fallback notice, and
   `deepseek-v4-pro` on the completed response. This uses the actual renderer
   components and a local-only connection-save stub.
3. Turn the switch off; reload the page; confirm it remains off. Turn it back on.
   The fixture uses only the `storyflow-fallback-playground` localStorage key.
4. In an isolated desktop QA profile, repeat against the loopback fixture:
   select primary, trigger A,A,B, verify the selector remains on preferred A,
   the completed response shows B, and history still shows B after restart.
5. Trigger Retry-After then Stop; verify one terminal settlement, no new requests,
   and no hanging retry/busy state. Disable fallback and verify native retries
   remain on A. Auth-generation replacement must cancel old operations.

## Evidence from 2026-09-16

- Full repository test command: 5,829 pass, 11 skip, 0 fail, including isolated
  suites. `typecheck:all`, Pi executable build and all three i18n checks passed.
- Actual renderer Playground checked with ego-browser: default enabled, switch
  off persisted after reload, restored to enabled; one notice and the effective
  model badge rendered. The fixture made no provider calls.
- Independent review exposed cancellation inside awaited model selection and
  cooldown `requested_model` attribution. Both have real-session regressions;
  synchronous retry-event cancellation and config-generation replacement are
  also covered. Empty HTTP 200 streams fail across all four protocols.
- After review fixes, 42 real-session runtime cases pass, including dispose
  cancellation and rejection of unknown capabilities. Host-to-ModelRuntime
  registration tests distinguish declared limits from the synthetic default.
  Final targeted run: 212 pass, 0 fail across Pi, gateway and preference storage.
- Native desktop restart/Stop QA (steps 4–5 above) and production observation have
  not been run. Loopback runtime and renderer checks cover their separate seams.

## Release boundary

These checks do not establish production recovery. Before an authorized release,
refresh the Luna/403/524/Worker CPU observation window and deployment version.
Compare final generation completion, transport attempts per logical call, fallback
recovery and header/first-content latency. Never equate HTTP 200 with completion,
and never create paid probes merely to fill a production metric.
