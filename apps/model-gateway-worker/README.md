# Model Gateway Worker

Cloudflare Worker proxy for managed Storyflow model connections and the read-only
multi-source short-drama catalog across OpenAI Responses, Chat Completions, Anthropic Messages, and Google GenAI routes.
The gateway enforces model-to-protocol ownership and merges approved dynamic
families with NewAPI's live model inventory before exposing `/v1/models`.
Files: `wrangler.toml`, `package.json`, and `src/` for the Worker entrypoint plus tests.

`src/upstream-error.ts` adds bounded, safe retry metadata to failures while retaining
public error codes and response shapes. Logs mark `phase: headers`; HTTP 200 is
not stream completion. Model selection/retries live in Pi, never in this Worker.

With `STORYFLOW_ACCESS_ENFORCEMENT = "required"`, verified JWTs also require a current account/session decision through the Broker's private `ACCESS_AUTHORITY` Service Binding. No allow cache is used; dependency failures return 503 before upstream work. `legacy` exists only for the coordinated [managed access cutover](../../docs/managed-access-qa.md).
