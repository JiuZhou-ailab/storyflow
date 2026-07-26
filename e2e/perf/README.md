# perf e2e harness

Local-only Electron performance measurement (ADR-0001). Launches the built app against a fixture data dir and fail-closed checks writing-project startup, session-switch / memory diagnostics, heavy interaction, continuous typing, and document open/close leak scenarios. Never runs in CI.

Uses **raw CDP** (bun native WebSocket via `cdp.ts`), not Playwright — Playwright cannot complete a CDP handshake with Electron 39 / Chrome 142.

- `cdp.ts` — flat-session CDP client
- `launch.ts` — launch/teardown + heap GC + perf-log capture
- `navigation.ts` — ActivityRail project discovery + deterministic fixture selection
- `navigation.test.tsx` — rendered ActivityRail ↔ perf navigation contract
- `contract.ts` — strict scenario/config parsing and fail-closed baseline decision
- `contract.test.ts` — regression coverage for invalid or incomplete runs
- `run.ts` — scenario driver + pass/fail report
- `results/` — timestamped JSON reports (gitignored)

CI interaction proxies: `apps/electron/src/renderer/__tests__/interaction-perf-contracts.test.ts`
(included by root `bun test` via `*.test.ts` discovery).

## Run

```bash
# from repo root
bun run perf:fixture
cd apps/electron && bun run build   # once, if dist/ is stale
bun run perf:e2e                    # all scenarios

# diagnostics
PERF_SCENARIOS=continuous-typing,memory-leak-docs bun run perf:e2e
PERF_SCENARIOS=heavy-writing,heavy-search bun run perf:e2e
PERF_SCENARIOS=startup,switch,memory-steady,memory-leak bun run perf:e2e
```

Env knobs:

| Env | Default | Meaning |
|---|---|---|
| `PERF_FIXTURE` | `~/.craft-agent-perf-fixture` | Data root |
| `PERF_SCENARIOS` | all | csv of scenarios |
| `PERF_STARTUP_RUNS` | 3 | Startup samples |
| `PERF_SWITCHES` | 20 | Session switch samples |
| `PERF_LEAK_LOOPS` | 100 | Session-switch leak loops |
| `PERF_DOC_LOOPS` | 40 | Document open/close leak loops |
| `PERF_DOC_CHAPTERS` | 60 | Distinct chapters cycled by document leak loops |

Scenarios: `startup`, `switch`, `memory-steady`, `memory-leak`, `memory-leak-docs`, `heavy-writing`, `heavy-search`, `continuous-typing`.

`memory-leak-docs` judges the second of two equivalent chapter rings so bounded first-use caches are excluded while per-switch growth still fails the baseline.

Harness always sets `CRAFT_CLIENT_AUTH_REQUIRED=false` so the offline fixture is not blocked by the desktop login gate.

An explicit `PERF_SCENARIOS` value is diagnostic mode (selected baselines only).

## Navigation contracts

- **Startup / heavy-writing / memory-leak-docs**: ActivityRail → 400-chapter writing fixture → catalog + Tiptap
- **Switch / memory / continuous-typing**: ActivityRail → non-writing fixture → sessions + chat input
- **Heavy-search**: writing fixture → activity-search → results
