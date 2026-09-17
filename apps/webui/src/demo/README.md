# Browser product demo

The marketing hero loads this independent entry at `/demo/`. It imports the actual
Electron renderer through the Web UI Vite aliases, without the normal Web UI
login/server discovery/WebSocket bootstrap.

- `bootstrap.ts` installs instance-local storage and ElectronAPI before importing
  the renderer. Desktop startup opens the fixture through its normal visible file
  link; readiness waits for an editable document. These DOM references remain local
  to the demo and are exercised by the production browser check.
- `adapter.ts` owns the sample files, conversation, snapshots and synthetic task
  events. Unknown host calls fail visibly. No model/runtime/network fallback exists.
- `fixture.ts` defines the authored 黑洞直播 content and the two explicit scenarios.
  Selected scenario plus unchanged input is required; matching a keyword never runs
  a task. Edits target one unique current passage and preserve other manual edits.
- `main.tsx` composes real renderer providers and reports a crashed surface to the
  parent; `styles.css` contains demo host chrome and hides unavailable host controls.
- `index.html` identifies the sample, offers reset and applies a static-resource CSP.

Real product review semantics apply: task output is already written. Accept marks
reviewed; Reject runs the renderer's current-content-aware reverse edit. Reload/reset
replaces the entire memory instance, cancels its pending timer and disconnects boot
listeners. Parent storage and other iframe instances are never cleared or reused.

`bun run --cwd apps/marketing build` emits `apps/marketing/dist/demo/`; the intermediate
`apps/marketing/public/demo/` is ignored. Run `apps/marketing/qa-demo.mjs` with ego-browser
against the production marketing preview. The agreed seam is the public browser,
including actual document edits, review state, request attempts and reset behavior.
