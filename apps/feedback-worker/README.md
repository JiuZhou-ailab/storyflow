# Feedback Worker

Accepts desktop feedback submissions, stores pasted screenshots in Cloudflare R2, and creates GitHub issues with a server-side GitHub token.

Required production secret. Prefer a fine-grained GitHub token scoped to the target repository with Issues read/write permission:

```bash
cd apps/feedback-worker
bunx wrangler secret put FEEDBACK_GITHUB_TOKEN
```

Optional public asset base URL:

```bash
bunx wrangler r2 bucket create storyflow-feedback-assets
bunx wrangler deploy --var FEEDBACK_ASSET_PUBLIC_BASE_URL:https://feedback-assets.example.com
```

Desktop builds should bake the first-party custom domain:

```dotenv
STORYFLOW_FEEDBACK_ENDPOINT=https://storyflow-feedback.zjding.com/api/feedback
```

## Ingestion limits

Only PNG, JPEG, GIF, and WebP are accepted: declared MIME must match the byte signature.
SVG and other MIME types are rejected, including legacy SVG assets served through this Worker.
Limits are 5 attachments, 5 MiB per image, 15 MiB decoded total, and 21 MiB for the entire
JSON request (including base64 overhead). Streaming requests are bounded independently of
Content-Length. Raster responses use `nosniff` and a restrictive CSP.

The native `FEEDBACK_RATE_LIMITER` binding allows 5 submissions per IP per 60 seconds,
using Cloudflare's `CF-Connecting-IP` header, and returns 429 with Retry-After on denial.
Missing bindings fail closed. Namespace 19003 is reserved here; 19001/19002 are used by
the tool gateway. Native counters are location-local and eventually consistent, not a global
quota or authentication. See [Cloudflare rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Local checks: `cd apps/feedback-worker && bun run test`. Before a future deployment,
verify the namespace is unused by other account Workers and deploy the binding with the code.
No credentials or client protocol change is required. Public R2 custom domains bypass this
Worker's legacy-asset response filter; existing SVG objects on those domains require separate
operator cleanup. This change does not delete stored feedback or assets.
