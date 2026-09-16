# Tool Gateway Worker

Cloudflare Worker for authenticated, per-subject rate-limited Storyflow tool operations: search is adapted to AnySearch and rendered webpage extraction to Firecrawl.
Files: `wrangler.toml`, `package.json`, generated `worker-configuration.d.ts`, and `src/` for the Worker entrypoint plus tests.

With `STORYFLOW_ACCESS_ENFORCEMENT = "required"`, verified JWTs also require a current account/session decision through the Broker's private `ACCESS_AUTHORITY` Service Binding. No allow cache is used; dependency failures return 503 before upstream work. `legacy` exists only for the coordinated [managed access cutover](../../docs/managed-access-qa.md).
