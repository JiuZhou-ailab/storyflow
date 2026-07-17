# Skills Market

Public discovery and contribution surface for project-owned Storyflow Skills.

| Path | Role |
| --- | --- |
| `public/` | Static marketplace UI served by Workers Static Assets. |
| `src/catalog.ts` | Curated methodology index with provenance and distribution policy. |
| `src/packages.ts` | Deterministic single-Skill ResourceBundle builder and validator. |
| `src/index.ts` | Worker API, D1/R2 submission boundary, and static asset fallback. |
| `migrations/` | Versioned D1 schema. |

Local browse mode needs no Cloudflare resources:

```bash
bun run dev:local
```

Publishing requires D1, a private R2 bucket, and Cloudflare Access in front of
`/studio/*`, `/api/submissions`, and `/api/admin/*`. Copy the commented resource
bindings from `wrangler.resources.example.toml` only after provisioning them.

Provision and deploy from this directory:

```bash
bunx wrangler login
bunx wrangler d1 create storyflow-skills-market
bunx wrangler r2 bucket create storyflow-skills-market-packages
# Copy the returned D1 id and both bindings into wrangler.toml.
bunx wrangler d1 migrations apply storyflow-skills-market --remote
bunx wrangler secret put ADMIN_EMAILS
bunx wrangler secret put ACCESS_TEAM_DOMAIN
bunx wrangler secret put ACCESS_SUBMISSIONS_AUDIENCE
bunx wrangler secret put ACCESS_ADMIN_AUDIENCE
bun run deploy
```

Before deployment, create Cloudflare Access applications for `/studio/*`,
`/api/submissions`, and `/api/admin/*`. Set `ACCESS_TEAM_DOMAIN` to the exact
`https://<team>.cloudflareaccess.com` issuer and set the two audience variables
to their route-specific Access application AUD tags (comma-separated values are
accepted during a controlled rotation). The Worker verifies the assertion's
RS256 signature, issuer, audience, expiry, and not-before claims; missing
verification configuration fails closed. Access perimeter protection remains a
deployment requirement, not a substitute for origin verification.

The market never executes Skill code. MVP submissions accept text-only Skill
packages and remain pending until an administrator publishes an immutable
content-addressed version.
