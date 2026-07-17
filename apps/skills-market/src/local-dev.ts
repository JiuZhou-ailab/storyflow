// input: Local HTTP requests and static files under the Skills Market public directory
// output: Bun-hosted Worker-compatible API and SPA assets for end-to-end development
// pos: Local-only adapter; production remains Cloudflare Workers Static Assets

import { join } from 'node:path'
import { handleRequest, type Env } from './index.ts'

const publicRoot = join(import.meta.dir, '..', 'public')
const port = Number(Bun.env.PORT ?? 8791)

const env: Env = {
  MARKET_ORIGIN: `http://127.0.0.1:${port}`,
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url)
      const requested = url.pathname === '/' || url.pathname.startsWith('/studio') ? 'index.html' : url.pathname.slice(1)
      if (!requested || requested.includes('..') || requested.includes('\\')) return new Response('Not found', { status: 404 })
      const file = Bun.file(join(publicRoot, requested))
      if (!(await file.exists())) return new Response(Bun.file(join(publicRoot, 'index.html')))
      return new Response(file)
    },
  },
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: request => handleRequest(request, env),
})

console.log(`Skills Market local server: ${server.url}`)
