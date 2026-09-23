# Browser reuse pre-migration gate

This offline Electron probe records the public connection paths being considered for
[Storyflow #55](https://github.com/JiuZhou-ailab/storyflow/issues/55). It is **not** the
production `browser_tool` acceptance test and does not complete the feature.

The fixture creates two same-URL WebContentsViews labelled Session A/B in different
Electron partitions and an application-shell page. These labels simulate ownership;
the fixture does not instantiate Storyflow Sessions. Main-process IPC independently
reads the actual input values, so a successful tool response alone is insufficient.
Only temporary fixture pages are read or modified. User profiles are not loaded.

## Run

Use the repository Electron installed by `bun install`. Candidate packages stay in a
separate directory and are not production dependencies:

```sh
STORYFLOW_PROOF_DEPS=$(mktemp -d)
printf '{"private":true,"type":"module"}\n' > "$STORYFLOW_PROOF_DEPS/package.json"
bun add --cwd "$STORYFLOW_PROOF_DEPS" --exact @playwright/mcp@0.0.82 playwright-core@1.63.0 puppeteer-core@25.11.0 @modelcontextprotocol/sdk@1.29.0
export STORYFLOW_PROOF_DEPS
STORYFLOW_PROOF_REPORT=/tmp/storyflow-browser-reuse.json bun e2e/browser-reuse/run.mjs
```

`CRAFT_E2E_ELECTRON_BIN` can select another **Electron runtime executable**, not the
packaged Storyflow application (the probe supplies its own main script). The fixture
removes its temporary profile on completion. Remove the isolated dependency directory
after investigation if it is no longer needed.

## Interpretation

Exit 1 means no tested browser-level connection path met the basic production
preconditions, or the probe failed; inspect `error` separately from `checks`.
Exit 0 would only permit further evaluation, not complete the accuracy, cancellation,
background-rendering or platform acceptance matrix.

- Playwright and Puppeteer page selection are checked against the real input values.
- Playwright MCP receives the real public BrowserContext containing A. The probe
  asks its public tab tool to list pages and, if B is exposed, select and modify B.
  The fixture independently observes whether that cross-owner write happened.
- Different Electron storage partitions are inspected for actual BrowserContext
  separation; no assumption about equivalence is made.
- The raw debugging port is intentionally enabled only in this isolated fixture.
  Its unauthenticated discovery response demonstrates why directly exposing that
  endpoint is not a protected production transport. This is **not** evidence that
  an authenticated or non-network transport is impossible.
- Puppeteer's public ConnectionTransport is forwarded transparently to one
  `webContents.debugger`; no browser commands are emulated. This checks whether the
  already-scoped Electron page transport works without an additional protocol facade.

The production libraries remain unselected until a scoped, protected transport and
the agreed real-application behavior are demonstrated. The existing raw-CDP performance
harness and application browser implementation are unchanged.
