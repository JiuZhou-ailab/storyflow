# Model Gateway Worker

Cloudflare Worker proxy for managed Storyflow model connections and the read-only
multi-source short-drama catalog across OpenAI Responses, Chat Completions, Anthropic Messages, and Google GenAI routes.
The gateway enforces model-to-protocol ownership and merges approved dynamic
families with NewAPI's live model inventory before exposing `/v1/models`.
Catalog v3 currently serves the same models as v2. The gateway also serves the
published legacy catalog to older clients.
Deploy catalog changes to the production worker before tagging a release that
depends on them. The release canary reads the live catalog.
Files: `wrangler.toml`, `package.json`, and `src/` for the Worker entrypoint plus tests.

`src/upstream-error.ts` adds bounded, safe retry metadata to failures while retaining
public error codes and response shapes. Logs mark `phase: headers`; HTTP 200 is
not stream completion. Model selection/retries live in Pi, never in this Worker.

Upstream 401/403, request/policy errors, quota exhaustion and unknown-scope 429
are terminal (`retryable: false`); upstream access denial is separate from a
Storyflow identity failure and must not renew/replay a user turn. Explicit
transient throttling and service/transport failures use Pi's native retry budget;
only eligible failures may feed the existing compatible-model selection policy.
Plain-text/empty Cloudflare 520/525 responses become HTTP 502 with
`code: upstream_origin_error`, a safe message and the real `upstream_status`
in both the top-level and nested error metadata. Structured upstream JSON errors
retain their codes and retry classification. Logs record status/code, never the
origin body. HTML errors retain their published `upstream_html_response` code.

Execution is pinned with `[placement] region` rather than Smart Placement, which
re-picks the location on every deploy and has landed on a colo whose path to the
upstream origin stalls. After a deploy, the colo suffix of the logged
`upstream_ray` (or the `cf-placement` response header) shows where the Worker ran;
check it against `upstream_status` before calling the deploy healthy.

With `STORYFLOW_ACCESS_ENFORCEMENT = "required"`, verified JWTs also require a current account/session decision through the Broker's private `ACCESS_AUTHORITY` Service Binding. No allow cache is used; dependency failures return 503 before upstream work. `legacy` exists only for the coordinated [managed access cutover](../../docs/managed-access-qa.md).

The authenticated model catalog includes approved fallback capabilities and may be
empty after account filtering. Consumers must persist an empty success rather than
restore bundled models. New Pi clients request `x-storyflow-error-format: sdk-v1`:
access failures then include a standard nested `error` object plus the existing
top-level diagnostic fields, so OpenAI SDK normalization retains them. Callers
without this opt-in retain the published string `error` shape. Remove that legacy
branch only when the minimum supported desktop and direct HTTP consumers accept
the SDK envelope; identity/tool HTTP APIs are unchanged.
