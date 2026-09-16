// input: Failed upstream HTTP responses at the gateway's error boundary.
// output: Permanent/transient classification and bounded, compatible retry metadata.
// pos: Contract tests for gateway normalization, independent of account authorization.
import { expect, test } from "bun:test";
import { normalizeUpstreamError } from "./upstream-error";

for (const [status, code, retryable] of [
  [403, "unknown", false],
  [401, "invalid_api_key", false],
  [503, "server_error", true],
  [429, "rate_limit_exceeded", true],
  [429, "insufficient_quota", false],
  [502, "invalid_request_error", false],
  [403, "model_not_found", false],
  [400, "content_policy_violation", false],
  [429, "unknown", false],
] as const)
  test(`HTTP ${status} / ${code} retryable=${retryable}`, async () => {
    const normalized = await normalizeUpstreamError(
      Response.json(
        { error: { message: "fixture", code } },
        { status, headers: { "retry-after": "1", "cf-ray": "fixture-ray" } },
      ),
    );
    expect(normalized.response.headers.get("x-should-retry")).toBe(
      String(retryable),
    );
    expect(normalized.response.headers.get("retry-after")).toBe("1");
    expect(await normalized.response.json()).toMatchObject({
      upstream_status: status,
      retryable,
      retry_after_ms: 1000,
    });
  });

test("unknown 403 is access denial without inventing a provider-key cause or logging its body", async () => {
  const result = await normalizeUpstreamError(
    new Response("<html>private upstream details</html>", {
      status: 403,
      headers: { "content-type": "text/html", "retry-after": "garbage" },
    }),
  );
  expect(result.response.status).toBe(502);
  expect(result.response.headers.has("retry-after")).toBe(false);
  expect(await result.response.json()).toMatchObject({
    error: "Upstream access denied",
    code: "upstream_auth_failed",
    scope: "upstream_access",
    retryable: false,
  });
});
