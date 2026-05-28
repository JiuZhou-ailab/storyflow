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

Desktop builds should bake:

```dotenv
STORYFLOW_FEEDBACK_ENDPOINT=https://storyflow-feedback.d1095245867.workers.dev/api/feedback
```
