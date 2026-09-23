# Pi dependency patches

Pinned target: [Pi 0.87.1](https://github.com/earendil-works/pi/releases/tag/v0.87.1).
Contracts: [#41](https://github.com/JiuZhou-ailab/storyflow/issues/41),
[#43](https://github.com/JiuZhou-ailab/storyflow/issues/43),
[#48](https://github.com/JiuZhou-ailab/storyflow/issues/48).

## Hunk decisions (2026-09-23)

| Area | Decision and observable contract | Regression / removal gate |
| --- | --- | --- |
| pi-ai provider onResponse | Retain for rejected HTTP, all four APIs; expose permanent denial before outer retries | managed-access-contract.test.ts, permanent 401/403 and x-should-retry=false |
| pi-ai retry classifier / provider-retry | Retain permanent denial precedence, bounded JSON metadata for Google lost headers, server delay and timer overflow handling | managed-access-contract.test.ts, managed-fallback.test.ts |
| pi-ai Models refreshHeaders | Delete duplicate forwarding; product sessions prepare requests through coding-agent ModelRuntime | managed-access-contract.test.ts and managed-fallback.test.ts pass without the hunk |
| pi-ai beforeRetry / refreshHeaders forwarding | Retain actual transport-attempt correlation with stable logical call id | managed-fallback.test.ts, transport attempts and parallel sessions |
| pi-ai simple-options / Anthropic / Bedrock thinking | Retain explicit maxTokens as combined output cap; disable budget-based thinking when the final cap cannot fit the 1024-token minimum and answer reserve; unset requests retain native capacity | managed-access-contract.test.ts and thinking-budget.test.ts |
| coding-agent caller output cap | Retain optional maxOutputTokens for native length recovery; reaching an explicit query cap is terminal, while below-cap truncation retains native recovery; primary sessions leave this unset | runtime-budgets.test.ts, 8192 versus 4096 output; remove when unpatched Pi honors the caller cap |
| coding-agent model-runtime | Retain refreshed headers through ModelRuntime | same correlation checks |
| coding-agent session response / backoff | Retain permanent rejection guard and server delay lower bound; native budget/settlement remain intact | same denial, Retry-After and overflow checks |
| coding-agent abort / dispose revision | Retain cancellation through awaited prompt preflight and synchronous retry events; preserve native run cleanup | managed-access-contract.test.ts, cancellation races and adjacent prompt |
| coding-agent model selection revision | Retain newer explicit selection winning an older auth await | managed-fallback.test.ts, manual choice during automatic selection |
| coding-agent retry history slicing | Delete; 0.87.1 native recovery omission uses append-only context edits | native failed-continuation checks and primary-session.test.ts |
| coding-agent compaction + settings maxSummaryTokens | Retire 8192 default; retain only explicit caller cap through stream options, never model metadata | runtime-budgets.test.ts, actual native compaction and explicit1024 request cap |
| coding-agent summary validation | Reject empty or whitespace-only provider text before compaction, split-turn or branch summaries can become checkpoints | runtime-budgets.test.ts, empty/blank compaction preserves context and branch summary rejects blank output; remove when unpatched Pi passes |

Reproduction materials for upstream submission are the two real-session suites
below. They use loopback HTTP, no paid provider, and observable requests/results;
no upstream issue/PR has yet been submitted for these remaining gaps. In the
isolated unpatched 0.87.1 run they reproduce denials retried, early retry,
cancellation and correlation regressions; migrated patches pass the same 72 tests.
Remove each hunk when its named checks pass on a supported **unpatched** release.
Do not infer outer AgentSession correctness from provider SDK retries alone.

```sh
bun test packages/pi-agent-server/src/managed-access-contract.test.ts packages/pi-agent-server/src/managed-fallback.test.ts
bun test packages/pi-agent-server/src/runtime-budgets.test.ts packages/pi-agent-server/src/primary-session.test.ts
```

Bun applies the two patches through root package.json. They retain the existing optional maxSummaryTokens setting and its types;
no default is supplied. Verify resolved package paths and versions
before testing; stale package-local node_modules must not shadow the root version.
The extension layer never edits error text, request bodies, raw history or SSE to
control retries. Native retry context edits and cancel/settlement behavior remain
owned by Pi.
