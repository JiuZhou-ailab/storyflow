# Pi Agent Server

Out-of-process product adapter that projects Pi AgentSession into Storyflow's host protocol.

The release artifact is a Bun compiled binary so Pi's native virtual-module loader can execute npm Extensions without shipping a second dependency tree.

- `patches/` — Version-pinned Bun patches for upstream Pi protocol defects.
- `src/index.ts` — JSONL process boundary and persistent parent AgentSession lifecycle.
- `src/ephemeral-llm-query.ts` — Disposable Pi session lifecycle for `call_llm` and mini-completions.
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
- `src/provider-hooks.ts` — Narrow Pi-native request-header and response diagnostics hooks; retry remains Pi-owned.
- `src/gemini-thought-signature-compat.test.ts` — Pins Pi's Gemini 3 cross-provider tool-history compatibility contract.
- `src/network-proxy.ts` — Transport-only proxy routing for the Bun subprocess.
- `src/tools/` — built-in web and search tool definitions.
