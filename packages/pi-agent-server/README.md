# Pi Agent Server

Out-of-process product adapter that projects Pi AgentSession into Storyflow's host protocol.

The release artifact is a Bun compiled binary so Pi's native virtual-module loader can execute npm Extensions without shipping a second dependency tree.

- `patches/` — Version-pinned Bun patches for upstream Pi protocol defects.
- `src/index.ts` — JSONL process boundary and persistent parent AgentSession lifecycle.
- `src/ephemeral-llm-query.ts` — Disposable Pi queries with explicit budgets, deadlines, schema validation and output integrity.
- `src/primary-session.ts` — Primary Pi AgentSession construction, resources, Extensions, tools, and resume/branch setup.
- `src/pi-model-runtime.ts` — Pi provider credentials, custom endpoint registration, and model resolution.
- `src/pi-tool-runtime.ts` — Pi Extension permission hooks, Host capability proxying, large-result handling, and product rewind handshake.
- `src/subagent-tool.ts` — built-in ephemeral Subagent Run with Host-enforced capability profiles.
- `src/project-resource-loader.ts` — Pi-native resource/package discovery plus Storyflow compatibility paths.
- `src/system-prompt-override.ts` — Stable product prompt policy plus non-persistent per-turn context projection through Pi's native hooks.
- `src/print-system-prompt.ts` — Safe runtime prompt snapshot without executing user Extensions.
- `src/extension-ui.ts` — Pi Extension dialogs projected onto Storyflow's existing structured-question flow.
- `src/product-rewind.ts` — Durable Pi user-entry to Storyflow transcript-cut mapping.
- `src/tool-hooks.ts` — Pi-native permission and result hooks.
- `src/provider-hooks.ts` — Stable Model Call / transport-attempt correlation and native stream diagnostics; retry remains Pi-owned.
- `src/managed-fallback.ts` — Session-scoped managed model selection within native retry budgets; cooldown survives resource reload and resets with connection/credential generation.
- `src/gemini-thought-signature-compat.test.ts` — Pins Pi's Gemini 3 cross-provider tool-history compatibility contract.
- `src/network-proxy.ts` — Transport-only proxy routing for the Bun subprocess.
- `src/tools/` — built-in web and search tool definitions.

Managed fallback defaults on for trusted managed connections only, but requires
explicit `fallbackCapabilities` on both source and candidate. The approved chat
families have documented declarations; gateway discovery alone never qualifies a
candidate. Parent and subagent output budgets follow Pi's native model capacity,
remaining context and explicit caller limits; Storyflow adds no global output cap.
See [QA](../../docs/model-fallback-qa.md) and [pinned Pi patches](patches/README.md).

Pi 0.87.1 owns compaction defaults and history projection. Startup errors preserve
the existing session; no JSONL sanitizer or error-text retry hook runs. Cache warming
is stopped through the native decision event without changing Pi CLI preferences.
Upgrade evidence and rollback boundaries are in [Pi upgrade QA](../../docs/pi-native-upgrade-qa.md).

Long-task contracts and the compiled-binary release gate are documented in
[long-task QA](../../docs/long-task-runtime-qa.md). Built-in `subagent` uses Pi
customTools precedence; its Extension owns lifecycle and result hooks. Global resources
and non-conflicting Extension tools remain Pi-owned.
