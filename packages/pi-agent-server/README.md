# Pi Agent Server

Out-of-process product adapter that projects Pi AgentSession into Storyflow's host protocol.

The release artifact is a Bun compiled binary so Pi's native virtual-module loader can execute npm Extensions without shipping a second dependency tree.

- `src/index.ts` — JSONL process boundary and persistent parent AgentSession lifecycle.
- `src/subagent-tool.ts` — built-in ephemeral Subagent Run with Host-enforced capability profiles.
- `src/project-resource-loader.ts` — Pi-native resource/package discovery plus Storyflow compatibility paths.
- `src/extension-ui.ts` — Pi Extension dialogs projected onto Storyflow's existing structured-question flow.
- `src/product-rewind.ts` — Durable Pi user-entry to Storyflow transcript-cut mapping.
- `src/tool-hooks.ts` — Pi-native permission and result hooks.
- `src/provider-hooks.ts` — Narrow Pi-native request-header and response-status hooks.
- `src/network-proxy.ts` — Transport-only proxy routing for the Bun subprocess.
- `src/tools/` — built-in web and search tool definitions.
