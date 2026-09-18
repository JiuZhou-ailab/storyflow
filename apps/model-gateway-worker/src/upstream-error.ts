// input: A failed upstream HTTP response; successful streams never enter this module.
// output: Compatible gateway errors with safe retry semantics and no credential/body logging.
// pos: Gateway error boundary; it never retries, selects a model, or parses SSE.
const SAFE_CODES = new Set([
  "insufficient_quota",
  "billing_hard_limit_reached",
  "invalid_api_key",
  "model_not_found",
  "model_not_allowed",
  "content_policy_violation",
  "invalid_request_error",
  "rate_limit_exceeded",
  "server_error",
  "overloaded_error",
]);
const PERMANENT_CODES = new Set([
  "insufficient_quota",
  "billing_hard_limit_reached",
  "invalid_api_key",
  "model_not_found",
  "model_not_allowed",
  "content_policy_violation",
  "invalid_request_error",
]);

export async function normalizeUpstreamError(
  response: Response,
): Promise<{ response: Response; code?: string; retryable: boolean }> {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const rawRetryAfter = headers.get("retry-after");
  const seconds =
    rawRetryAfter && /^\d+(?:\.\d+)?$/.test(rawRetryAfter)
      ? Number(rawRetryAfter)
      : NaN;
  const retryAfterMs = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(rawRetryAfter ?? "") - Date.now();
  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0)
    headers.delete("retry-after");
  const contentType = headers.get("content-type") ?? "";
  const html = /text\/html|application\/xhtml\+xml/i.test(contentType);
  // Bound error inspection independently of upstream Content-Length. Never log this data.
  const reader = response.clone().body?.getReader();
  let text = "";
  let truncated = false;
  if (reader && !html) {
    const decoder = new TextDecoder();
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_384) {
          text = "";
          truncated = true;
          break;
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  } else {
    void reader?.cancel().catch(() => {});
  }
  let body: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      body = parsed as Record<string, unknown>;
  } catch {
    /* Non-JSON errors retain their existing response unless normalized below. */
  }
  const error =
    body?.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>)
      : undefined;
  const rawCode = error?.code ?? error?.type ?? body?.code;
  const code =
    typeof rawCode === "string" && SAFE_CODES.has(rawCode)
      ? rawCode
      : undefined;
  const denied = response.status === 401 || response.status === 403;
  const retryable =
    !denied &&
    response.headers.get("x-should-retry")?.trim().toLowerCase() !== "false" &&
    !PERMANENT_CODES.has(code ?? "") &&
    (response.status >= 500 ||
      response.status === 408 ||
      (response.status === 429 && code === "rate_limit_exceeded"));
  const scope = denied
    ? "upstream_access"
    : PERMANENT_CODES.has(code ?? "")
      ? "upstream_request"
      : retryable
        ? "upstream_capacity"
        : "upstream_unknown";
  const metadata = {
    upstream_status: response.status,
    scope,
    retryable,
    ...(code ? { upstream_code: code } : {}),
    ...(Number.isFinite(retryAfterMs) && retryAfterMs >= 0
      ? { retry_after_ms: Math.ceil(retryAfterMs) }
      : {}),
  };
  headers.set("x-should-retry", String(retryable));
  let status = response.status;
  if (denied) {
    status = 502;
    body = {
      error:
        response.status === 403
          ? "Upstream access denied"
          : "Model provider authentication failed",
      code: "upstream_auth_failed",
    };
  } else if (html) {
    status =
      response.status === 524
        ? 504
        : response.status >= 500
          ? 502
          : response.status;
    body = {
      error: {
        message: "Upstream gateway returned an unexpected HTML response",
        type: "upstream_error",
        code: "upstream_html_response",
      },
    };
  } else if (response.status === 400 && !truncated && !text.trim()) {
    status = 502;
    body = {
      error: {
        message: "Model provider rejected the request without an error body",
        type: "upstream_error",
        code: "upstream_empty_response",
      },
    };
  }
  if (!body)
    return {
      response: new Response(response.body, { status, headers }),
      code,
      retryable,
    };
  // Nested metadata survives SDKs that extract only `error`; top-level fields preserve old shapes.
  const nested =
    body.error && typeof body.error === "object"
      ? { error: { ...body.error, ...metadata } }
      : {};
  headers.set("content-type", "application/json");
  void response.body?.cancel().catch(() => {});
  return {
    response: new Response(
      JSON.stringify({ ...body, ...nested, ...metadata }),
      { status, headers },
    ),
    code,
    retryable,
  };
}
