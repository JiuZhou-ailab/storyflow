// input: Real local WebSocket CDP responses and connection termination
// output: Method-specific diagnostics on protocol errors and lost connections
// pos: Transport regression coverage for core E2E failure artifacts
import { expect, test } from 'bun:test'
import { CdpClient } from './cdp'

test.each(['error', 'close'] as const)('reports the pending CDP method on %s', async mode => {
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return
      return new Response('WebSocket required', { status: 400 })
    },
    websocket: {
      message(ws, raw) {
        const { id } = JSON.parse(String(raw))
        if (mode === 'error') ws.send(JSON.stringify({ id, error: { message: 'Execution context was destroyed.', code: -32000 } }))
        else ws.close()
      },
    },
  })
  const client = await CdpClient.connect(`ws://127.0.0.1:${server.port}`)
  try {
    await expect(client.send('Runtime.callFunctionOn')).rejects.toThrow(
      mode === 'error' ? 'CDP Runtime.callFunctionOn: Execution context was destroyed. (-32000)' : 'CDP Runtime.callFunctionOn: socket closed',
    )
  } finally {
    client.close()
    server.stop(true)
  }
})
