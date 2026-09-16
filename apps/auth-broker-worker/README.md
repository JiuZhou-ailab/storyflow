# Auth Broker Worker

HTTPS desktop auth broker for Feishu/Neon identity exchange, renewable model access, on-demand managed tool access, and ephemeral Skills Market publication.
Files: `wrangler.toml`, `package.json`, and `src/` for signed-claim verification, independently keyed capability issuance, key rotation, and tests.

`migrations/` owns durable Account Access, per-login sessions and atomic access-change audit in D1. `src/worker.ts` exposes the private `AccessAuthority` RPC entrypoint for model/tool gateways; the HTTP surface has no admin API. Operator commands live in `scripts/access-admin.ts`.

Run `bun run typecheck` and `bun test` here. Native D1/Service Binding acceptance uses Node through the Bun test runner. Provisioning, the temporary `legacy` mode, one-login cutover and rollback restrictions are documented in [managed access QA](../../docs/managed-access-qa.md).
