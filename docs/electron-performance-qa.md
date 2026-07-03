# Electron Performance QA

Use this runbook for desktop performance work. Lighthouse is still useful for web surfaces, but it does not exercise the Electron shell, preload bridge, local RPC transport, filesystem handlers, or native window behavior.

## Scope

- Use Lighthouse for `apps/marketing`, `apps/webui`, and `apps/viewer`.
- Use Electron runtime logs and targeted workflow QA for `apps/electron`.
- Treat renderer latency, RPC transport latency, server handler latency, and paint latency as separate evidence streams.

## Local Workflow

1. Capture the start time for this QA run:

   ```bash
   ELECTRON_QA_STARTED_AT="$(bun -e 'console.log(new Date().toISOString())')"
   ```

2. Start the app from source:

   ```bash
   bun run electron:dev
   ```

3. Exercise the workflow under review. For writing workspace latency, switch between several document files and wait for the editor to settle after each switch.

4. Summarize only the log lines from this run:

   ```bash
   bun run perf:electron -- --since "$ELECTRON_QA_STARTED_AT" --slow 100 --limit 20
   ```

   Use the evidence gate when the run must prove main-process instrumentation is loaded:

   ```bash
   bun run perf:electron -- --since "$ELECTRON_QA_STARTED_AT" --slow 100 --limit 20 --require-main-spans
   ```

5. When sharing raw data or comparing runs, use JSON:

   ```bash
   bun run perf:electron -- --since "$ELECTRON_QA_STARTED_AT" --json > /tmp/electron-perf.json
   ```

For quick local triage without a saved start timestamp, use `--last-minutes <n>`.

## Interpreting Writing Workspace Metrics

- `writing.document.saveBeforeSwitch`: time spent saving the previous document before navigation.
- `writing.document.readFile`: renderer-observed end-to-end `window.electronAPI.readFile` latency.
- `rpc.file.read`: server-side file read handler latency, including path validation and disk read marks.
- `fs.searchBatch`: server-side workspace search latency, including request count, snapshot size, and total results.
- `fs.listFiles`: server-side known-root workspace listing latency, including root count and result count.
- `writing.document.readyAfterRead`: time until React state is updated after selecting a document.
- `writing.document.paintAfterRead`: time until the next paint after document selection.

If `writing.document.readFile` is high and `rpc.file.read` is low, investigate transport queuing, main-process event-loop pressure, or renderer-side waiting. If both are high, inspect path validation, disk I/O, and concurrent filesystem scans. If paint dominates, inspect renderer tree size and editor updates.

Use `fs.listFiles` for known-root writing workspace switches and `fs.searchBatch` metadata for fallback discovery/catalog work. A healthy writing-workspace switch should not repeatedly emit identical list roots or high-request batch searches.

The summary also reports raw filesystem activity from `[FS_LIST_FILES]`, `[FS_SEARCH_BATCH]`, and `[FS_SEARCH]` log lines. List calls show the intended known-root path, batch calls show fallback catalog search, and single calls show fallback or legacy paths. If the summary has raw calls but no matching `fs.listFiles` or `fs.searchBatch` perf span, restart Electron after main-process changes before judging the new code.

Pay attention to the `Instrumentation Notes` section. It is emitted when renderer-side symptoms are present but the paired main-process spans are missing, which usually means the Electron main process has not been restarted after instrumentation changes.

Known writing workspace roots use one combined path-only catalog search on refresh. Unknown roots still do the safer two-phase detection and catalog pass. If a known-root refresh emits separate detection and catalog batches again, treat it as a regression unless the workspace contract has changed.

When the batch search channel is unavailable or fails, the renderer falls back to single-file searches.

## Architecture Checks

- Renderer code should own UI state and workflow composition only.
- Preload and transport should only adapt typed `ElectronAPI` calls to shared RPC channels.
- `packages/server-core/src/handlers/rpc/*` should own filesystem, session, and platform-side effects.
- Shared protocol and utility packages should remain the contract boundary; avoid duplicating channel names or response shapes in UI code.

Minimum verification for performance changes:

```bash
bun test scripts/__tests__/electron-perf-summary.test.ts
bun test packages/server-core/src/handlers/rpc/files.write.test.ts
cd packages/server-core && bun run tsc --noEmit
git diff --check
```
