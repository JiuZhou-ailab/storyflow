# Managed model fallback QA (Spec #41)

No paid provider is required. Keep production credentials and user settings out of
these fixtures. Runtime acceptance uses real Pi AgentSession instances against
loopback HTTP; only the external provider response and clock are controlled.

The approved chat families now carry explicit `fallbackCapabilities` in
`MANAGED_MODEL_CATALOG`. Gateway `/v1/models` publishes them, the authenticated
catalog refresh validates/persists them, and both runtime creation and refresh
use the same Pi projection. Missing capabilities still exclude a candidate;
discovery never approves a new family. Tests use these product declarations,
not only synthetic fixture metadata.

Capability evidence checked 2026-09-16 (output limits and function/tool calling):

| Models | Declared output ceiling | Primary sources |
| --- | ---: | --- |
| GPT-5.5, GPT-5.6 Sol/Terra/Luna | 128,000 | [5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Terra](https://developers.openai.com/api/docs/models/compare), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| Claude Sonnet 5 / Opus 5 | 128,000 | [Sonnet](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5), [Opus](https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5), [tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) |
| Gemini 3.5 / 3.6 / 3.7 / 3.8 Flash | 65,536 | [3.5](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash), [3.6](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [3.7](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash), [3.8](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) |
| DeepSeek V4 Flash / Pro | 384,000 | [API model details](https://api-docs.deepseek.com/quick_start/pricing/) (conservative interpretation of 384K) |

DeepSeek documents `deepseek-v4-flash` as a retained alias now served by V4.1
Flash; do not infer image equivalence with Pro. Storyflow's existing text-only
DeepSeek contract remains unchanged. These declarations describe documented model
capability, not live NewAPI route availability or verified production health.
A route that changes model identity/limits must update its declaration or be
excluded. `structuredOutput: prompt` records Storyflow's existing prompt-based
schema path; it does not enable native strict-schema mode.

Parent and subagent requests follow Pi's native model output capacity and
remaining-context limits, including after fallback. Storyflow adds no global
8192-token cap. Explicit per-call budgets (such as `call_llm`) remain separate.

## Catalog retirement and Flash connectivity (2026-09-23)

Gemini 3.5, 3.6, 3.7 and 2.5 Flash are retired from Storyflow's managed catalog.
Local retirement policy applies both to persisted account catalogs and live gateway
refreshes, so an older deployed gateway cannot restore them. Account-scoped empty
catalogs remain empty. Earlier capability tables above are historical evidence.

The UI labels the retained `deepseek-v4-flash` route as DeepSeek V4.1 Flash.
A minimal authenticated request through the deployed Storyflow gateway returned
HTTP 200, `OK`, `finish_reason=stop`, and model `deepseek-v4-1-flash-260910`
(33 prompt + 17 completion tokens). The guessed ID `deepseek-v4.1-flash` was
rejected by the gateway with HTTP 403 and was not forwarded upstream. Official
[model documentation](https://api-docs.deepseek.com/quick_start/pricing/) names
`deepseek-flash` and retains `deepseek-v4-flash` as a V4.1 compatibility alias.
This verifies a text completion through the existing route, not tools, images,
load handling or the upstream model's internal identity.

## Automated checks

```sh
bun test packages/pi-agent-server/src/managed-fallback.test.ts packages/pi-agent-server/src/managed-access-contract.test.ts
bun test apps/model-gateway-worker/src/index.test.ts apps/model-gateway-worker/src/upstream-error.test.ts
bun test packages/pi-agent-server/src/provider-hooks.test.ts packages/pi-agent-server/src/subagent-tool.test.ts packages/pi-agent-server/src/pi-sdk-boundary.test.ts
bun run typecheck:all
```

The runtime suite verifies all four native protocols; A,A,B recovery; shared retry
budget; permanent rejection with nonzero provider retry budgets; Retry-After/cancel; partial text/reasoning/tool args;
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
