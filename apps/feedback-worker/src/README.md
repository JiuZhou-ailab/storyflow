# src

`index.ts` contains the Worker fetch handler, bounded JSON parsing, declared/content-sniffed
raster image validation, Cloudflare IP rate limiting, optional R2 uploads, and GitHub issue
creation. Validation finishes before either external write. The wire payload is unchanged.

`index.test.ts` exercises the HTTP boundary with R2/GitHub/rate-limiter boundary fakes,
including spoofed MIME, malformed base64, request streaming limits, and rejection before writes.

`index.runtime.test.ts` runs the configured native rate limiter in local workerd and verifies
the HTTP limit and IP isolation without network services or deployment.
