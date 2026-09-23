# Long-task runtime QA (#43)

Contract: [storyflow#43](https://github.com/JiuZhou-ailab/storyflow/issues/43).
This changes product defaults and integrity projection; Pi remains the runtime.
These initial budgets are not a measured optimum for creative quality.

## Runtime choices

Parent and subagent sessions use Pi's native output limits: model capacity,
remaining context and explicit caller settings. There is no Storyflow-wide
8192-token cap. The following budgets apply only to the dedicated `call_llm` tool.

| Call | Output tokens | Thinking | Deadline |
| --- | --- | --- | --- |
| Ordinary call_llm | 8,192 | medium | 120 seconds |
| Explicit `longOutput: true` | 16,384 | medium unless specified | 300 seconds |
| Explicit overrides | `maxTokens` 1–32,768, capped by trusted capacity | off/low/medium/high/xhigh/max | `timeoutMs` 1–300,000 |

Registered model capacity is separate from request budget. Unknown custom output
capacity remains 8,192. Existing explicit user thinking choices remain unchanged.
Main-session compaction uses Pi 0.87.1 native defaults, including summary capacity.
Explicit user settings (including disabled compaction) survive model changes and
reload. Spec #48 retires the initial 80% / 32k / 8192 compaction policy, not the
explicit summary/call_llm budgets or output-integrity contract.

`call_llm.outputPath` names a new file in an existing directory. The Host checks
write permissions and conflicts before inference. Safe mode rejects file output.
Only `completed` results are published; a complete temporary file is hard-linked
into place with no replacement. Return text contains a bounded preview and path.
Default text delivery remains available. Exact read and generation results can
be recovered from saved full content, rather than substituted with summaries.

## Automated local Provider checks

Run the following without real model credentials or a paid Provider:

```sh
bun test packages/pi-agent-server/src/runtime-budgets.test.ts
bun test packages/pi-agent-server/src/ephemeral-llm-query.test.ts
bun test packages/pi-agent-server/src/managed-access-contract.test.ts
bun test packages/pi-agent-server/src/subagent-tool.test.ts
bun test packages/pi-agent-server/src/exact-tool-output.test.ts
bun test packages/shared/src/agent/__tests__/llm-output-file.test.ts
bun test packages/shared/src/agent/__tests__/pi-event-adapter.test.ts
bun test packages/shared/src/agent/__tests__/pi-query-llm.test.ts
bun test packages/pi-agent-server/src/compiled-subagent.test.ts
```

The binary smoke compiles the canonical entrypoint into a temporary directory,
launches from a clean cwd with an empty PATH, and uses a loopback HTTP Provider.
It installs a conflicting `subagent` and a non-conflicting global Extension tool,
checks the actual schema, and executes a child read through Host permission RPC.
Source-only green tests do not replace this release gate.

Query tests observe real Provider budgets and result statuses, strict JSON schema
acceptance, deadline cleanup, and concurrent independent episode Model Inputs.
The two-episode fixture saves each completed episode separately and lets only its
coordinator publish continuity after both results pass validation.

## Desktop runbook

Use a development build with a loopback Provider; do not run a production novel.

1. Load a long conversation, observe compacting status, then the native completion
   and updated context estimate. Switch window sizes and reload resources; verify
   native defaults and explicit disabled settings survive. Compare the
   original Source Document and Pi history files before and after compaction.
2. Return a normal response, partial text with `length`, and thinking-only `length`.
   Confirm partial content is retained with an incomplete error, and a native
   recovered response does not produce an early incomplete error. With a model
   whose output capacity exceeds 8192, verify parent and child requests use that
   capacity when context permits. Inspect actual
   model/stopReason in Boundary Protocol diagnostics.
3. Generate a new output file with `call_llm`. Open its reference and compare exact
   bytes. Repeat with an existing target, safe mode and denied permission; verify
   no new Provider request starts and no existing content changes.
4. Cancel generation and repeat with deadline expiry. Confirm query cleanup, no
   late success and no published formal artifact. Start a subsequent query to
   ensure cancellation does not poison it.
5. Force summary failure and cancel manual compaction adjacent to a new prompt.
   Verify only native settlement completes the turn and history remains loadable.

Desktop visual checks require running the changed development build. They are
separate from the automated binary smoke; record build SHA and observed results
before treating a release as visually verified.

## Implementation verification (2026-09-21)

- Real loopback tests cover actual budgets across four protocols, thinking-only
  length, strict schema checks, setup cancellation, independent episode queries,
  automatic compaction around the threshold, summary cancellation/failure,
  model switching and resource reload. No paid Provider calls were used.
- Compiled-binary smoke passed both complete and length child responses. Native
  tool-result hooks preserve child failures despite Pi ignoring an `isError`
  field returned directly from a custom tool's execute function.
- Standards and Spec reviews found and resolved strict-schema coercion,
  initialization cancellation, explicit-model fallback, proxy error propagation,
  directory replacement and cleanup/publication ambiguity. Publication uses the
  existing Node/Bun/Electron executable with an OS-held child cwd; all writes are
  relative to that directory. An unconfirmed helper termination is reported for
  inspection, with no automatic retry or overwrite.
- Desktop visual QA remains a separate release check; it was not executed against
  a running Electron development build during this implementation.

Repository validation snapshot: the full ordinary suite ran 5,640 tests (5,622
passed, 11 skipped, 7 failed). Three failures were old result/registration
expectations updated in this change and passed targeted reruns. Four remaining
locale failures concern concurrent `startup.*` additions outside this commit.
The HTTP suite passed 34 tests. The isolated suites additionally found three
browser-prerequisite failures caused by the concurrent stored-config change.
Pi-server typechecking passes; the latest whole-repository check reaches Electron
and is blocked by an unused `oauthFlowStore` in another in-progress change.
Unrelated working-tree changes were preserved and excluded from this commit.
