# Tool Gateway source

- `index.ts` validates tool capability JWTs, enforces per-operation rate limits, and contains server-only AnySearch search and Firecrawl scrape adapters.
- `index.test.ts` covers scope isolation, rate limiting, bounded input, private-URL rejection, credential isolation, and response projection.
