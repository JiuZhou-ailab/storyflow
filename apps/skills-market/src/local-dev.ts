// input: Local HTTP requests for the Skills Market API
// output: Bun-hosted Worker-compatible catalog and health endpoints
// pos: Local-only API adapter; production remains a Cloudflare Worker

import { handleRequest, type Env } from './index.ts'

const port = Number(Bun.env.PORT ?? 8791)

const env: Env = {}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: request => handleRequest(request, env),
})

console.log(`Skills Market local server: ${server.url}`)
