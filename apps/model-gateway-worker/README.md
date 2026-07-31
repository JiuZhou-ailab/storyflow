# Model Gateway Worker

Cloudflare Worker proxy for managed Storyflow model connections and the read-only
video catalog across OpenAI Responses, Chat Completions, Anthropic Messages, and Google GenAI routes.
The gateway enforces model-to-protocol ownership and merges approved dynamic
families with NewAPI's live model inventory before exposing `/v1/models`.
Files: `wrangler.toml`, `package.json`, and `src/` for the Worker entrypoint plus tests.
