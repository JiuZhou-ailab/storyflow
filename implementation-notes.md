# Implementation Notes

## 2026-05-22

- Confirmed `electron:dev` failure is consistent with a wedged local esbuild binary/service: `node_modules/@esbuild/darwin-arm64/bin/esbuild --version` did not return within 3 seconds.
- Treating the dev-start failure as an environment dependency repair first, not as a source regression in `packages/session-mcp-server`.
- Keeping edits scoped to chat layout, diff extraction/rendering, tests, and this notes file. The repository already contains unrelated modified files that are intentionally left untouched.
- Refreshed dependencies with `bun install --force`; after that, the esbuild binary returned `0.25.12` immediately and the session MCP entry reached normal CLI argument validation.
- Added a Write diff guard: captured previous-content metadata that exactly matches the new content is treated as absent, so a new-file write renders as additions instead of identical red/green content.
- Tightened chat transcript scroll containment by giving the shared ScrollArea an explicit viewport class hook and applying `min-h-0 overflow-y-auto` to the transcript viewport.
- During release verification, full tests exposed a stale short-form starter message contract. I expanded the user-facing starter copy to match the localized four-section onboarding expected by workspace creation tests.
- Full-suite source tests exposed a leaking Bun module mock in token refresh tests. I replaced the storage-module mock with an injected persistence hook on `TokenRefreshManager`, so the tests no longer contaminate global source storage imports.
- Release validation showed the old public R2 hostname resolves through an unusable local/proxy address for installer downloads. I moved the default release/update base URL to `story-storage.zjding.com`, updated the GitHub Actions variable, and will cut a new patch release instead of mutating the already-built `v0.9.15` artifacts.
