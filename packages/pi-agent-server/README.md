# Pi Agent Server

Out-of-process Pi SDK adapter for Storyflow sessions, tools, resources, and provider events.

- `src/index.ts` — JSONL process boundary and persistent parent AgentSession lifecycle.
- `src/subagent-tool.ts` — built-in ephemeral Subagent Run with Host-enforced capability profiles.
- `src/project-resource-loader.ts` — Storyflow resource and executable Extension trust boundary.
- `src/tool-hooks.ts` — Pi-native permission and result hooks.
- `src/tools/` — built-in web and search tool definitions.
