# Feedback Issue Ingestion

Storyflow feedback submission uses a server-side Cloudflare Worker instead of asking end users for GitHub access.

Flow:

1. The Electron feedback dialog sends title, details, contact email, app context, and pasted screenshots to `STORYFLOW_FEEDBACK_ENDPOINT`.
2. `apps/feedback-worker` validates the payload and uploads screenshots to the `FEEDBACK_ASSETS` R2 bucket when the binding is configured.
3. The Worker creates a GitHub issue in `GITHUB_REPOSITORY` with `FEEDBACK_GITHUB_TOKEN`.
4. Labels such as `feedback` and `ai-triage` can trigger the later Codex GitHub bot workflow.

Production defaults:

```dotenv
STORYFLOW_FEEDBACK_ENDPOINT=https://storyflow-feedback.zjding.com/api/feedback
```

Worker secrets and vars:

```bash
cd apps/feedback-worker
bunx wrangler r2 bucket create storyflow-feedback-assets
bunx wrangler secret put FEEDBACK_GITHUB_TOKEN
bunx wrangler deploy
```

Use a fine-grained GitHub token scoped to the target repository with Issues read/write permission. Keep it as a Worker secret; desktop clients should never receive GitHub credentials.

The desktop app always routes feedback through `STORYFLOW_FEEDBACK_ENDPOINT`. For local development, point that endpoint at a local or preview Worker rather than adding a desktop-side GitHub fallback. Use the first-party `storyflow-feedback.zjding.com` custom domain for production; `workers.dev` is only a Cloudflare development surface and is not a reliable installed-client endpoint.
