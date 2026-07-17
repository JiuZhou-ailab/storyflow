# 0001. Layered performance measurement: component benchmarks in CI, e2e perf local-only

Date: 2026-07-16

## Status

Accepted

## Context

The performance effort covers three axes (interaction responsiveness > memory footprint > startup time). Every optimization must leave behind a re-runnable perf baseline. Existing instrumentation (`apps/electron/src/renderer/lib/perf.ts`) logs session-switch marks, text-delta windows, and writing-document phases in debug mode, but nothing drives it automatically — there is no e2e harness in the repo.

Options considered:

1. Component-level benchmarks only (bun test + happy-dom) — fast, deterministic, CI-friendly, but blind to IPC, main process, GPU compositing; cannot measure startup or memory at all.
2. End-to-end only (Playwright for Electron) — full fidelity on all three axes, but expensive to build, slow, and perf numbers from shared CI runners are too noisy to compare.
3. Layered hybrid of both.

## Decision

Use the layered hybrid:

- **Interaction axis** — component-level benchmarks rendering real components against the standard fixture (see CONTEXT.md), run in CI as the regression guard. Root causes of interaction jank have consistently been in the render layer, so this covers most of the regression surface with zero flakiness. **CI asserts deterministic proxy metrics only** — re-render counts, commit counts, subscription-trigger counts (e.g. "typing one character re-renders the session list 0 times") — never wall-clock thresholds, which are meaningless on shared runners. Render count is the causal upstream of render time, so guarding it guards the root cause. Wall-clock budgets (the interaction budget tiers in CONTEXT.md) are judged exclusively by the local e2e runs.
- **Startup and memory axes** — Local Electron e2e harness (`e2e/perf/`) driving the real app with a fixture data directory, collecting `rendererPerf` logs and CDP metrics. Implementation uses **raw CDP** (bun WebSocket client) rather than Playwright: Playwright's CDP handshake hangs against Electron 39 / Chrome 142, while bare CDP works. **Deliberately excluded from CI**: perf numbers are only comparable on a fixed local machine. Run manually before/after optimizations.

## Consequences

- CI catches render-layer perf regressions cheaply; it does not catch startup/memory regressions — those rely on the manual e2e run being part of the optimization workflow.
- If a future need for CI perf gating on startup/memory arises, it requires a dedicated fixed-hardware runner; revisit this ADR then.
