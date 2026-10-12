# Agent core

Provider-agnostic Product Host capabilities used by the Pi runtime. Runtime execution and provider protocol handling stay outside this directory.

- `index.ts` — public exports
- `types.ts` — shared contracts
- `permission-manager.ts` — tool permission decisions
- `pre-tool-use.ts` — pre-execution policy checks
- `prerequisite-manager.ts` — required source-guide reads
- `prompt-builder.ts` — stable Host rules plus per-turn mode, capability, and filesystem data
- `source-manager.ts` — source state data and stable conditional guide policy
- `workspace-structure-context.ts` — workspace structure context
- `__tests__/` — focused capability regressions
