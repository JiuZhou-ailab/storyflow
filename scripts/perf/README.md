# scripts/perf

Deterministic performance-fixture generation for the Storyflow perf effort (see repo-root CONTEXT.md "Standard fixture").

- `generate-fixture.ts` — builds a CRAFT_CONFIG_DIR-compatible data root (`--seed`, `--scale`, `--out`); wipes only dirs carrying its `.perf-fixture` marker.
