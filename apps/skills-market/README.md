# Storyflow Skills Market

First-party API and immutable distribution service for Pi-native Storyflow
Skill Packages. Storyflow's desktop Skills Hub owns presentation and install
actions; this Worker never renders a web product or executes installed Skills.

| Path | Role |
| --- | --- |
| `src/catalog.ts` | Curated methodology seeds with provenance and distribution policy. |
| `src/packages.ts` | Deterministic single-Skill ResourceBundle validation. |
| `src/review.ts` | Synchronous Workers AI admission decision and output validation. |
| `src/index.ts` | HTTP, bearer identity, D1 publication, and R2 distribution. |
| `migrations/` | Versioned catalog and review-evidence schema. |

Publication is synchronous:

```text
identity → bounded bytes → deterministic validation → AI review → immutable R2 → D1 visibility
```

The authenticated publisher is recorded separately from the package's content
author. A publication may be `public`, or `company` when the short-lived bearer
token contains an organization claim. Anonymous readers see public Skills;
authenticated company members additionally see Skills from their organization.

Each successfully served bundle `GET` atomically increments that Skill's D1
download counter; metadata-only `HEAD` requests do not. The catalog exposes the
counter and derives `Featured` from the eight most-downloaded installable Skills,
so curated and member-published Skills share one popularity rule.

Invalid packages return `400`; AI rejection returns `422` without writes; an
unavailable or malformed review returns `503` without writes. Approval returns
`201` only after the published version is visible. License values remain
publisher declarations; AI review does not prove ownership.

Local anonymous API browse mode needs no Cloudflare resources:

```bash
bun run dev:local
```

Run the executable contract:

```bash
bun run test
bun run typecheck
```

Provision and deploy:

```bash
bunx wrangler login
bunx wrangler d1 migrations apply storyflow-skills-market --remote
bunx wrangler secret put STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET
bun run deploy
```

The Market secret must equal the auth broker's
`STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET` and must differ from both client
session and model-access secrets. Desktop publication uses a five-minute token
with audience `storyflow-skills-market` and scopes `skills:read` and
`skills:publish`; the token is never persisted or exposed to the renderer.
Catalog, detail, and bundle GETs accept the same optional bearer capability so
company Skills remain private. Anonymous GETs expose public Skills only, and
`POST /api/submissions` requires the bearer capability. All other paths,
including `/`, return a JSON `404`.
