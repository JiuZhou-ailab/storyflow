import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateStdioMcpConnection } from '../validation.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = (name: string) => join(HERE, 'fixtures', name)

describe('validateStdioMcpConnection', () => {
  it(
    'returns success and tool list for a spec-compliant stdio server',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-good.mjs')],
        timeout: 8000,
      })
      expect(result.success).toBe(true)
      expect(result.tools).toEqual(['echo'])
      expect(result.error).toBeUndefined()
    },
    15000,
  )

  it(
    'lets StdioClientTransport own the only server process',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcp-validation-'))
      const stateFile = join(dir, 'spawn-state.json')

      try {
        const result = await validateStdioMcpConnection({
          command: 'node',
          args: [FIXTURE('mcp-server-spawn-once.mjs')],
          env: { MCP_SPAWN_STATE_FILE: stateFile },
          timeout: 5000,
        })

        expect(result.success).toBe(true)
        expect(result.tools).toEqual(['once'])
        expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual({ count: 1 })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    15000,
  )

  it(
    'surfaces a framing hint when the server uses LSP-style Content-Length framing',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-lsp.mjs')],
        timeout: 12000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!).toContain('newline-delimited JSON-RPC')
      expect(result.error!).toContain('LSP-style framing')
      expect(result.error!).toContain('stderr silence')
    },
    45000,
  )

  it(
    'succeeds on a slow cold-start server that emits stderr activity throughout init',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-slow.mjs')],
        timeout: 60000,
      })
      expect(result.success).toBe(true)
      expect(result.tools).toEqual(['ping'])
      expect(result.error).toBeUndefined()
    },
    60000,
  )

  it(
    'fails at the ceiling when a server floods stderr but never completes initialize',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-noisy-stuck.mjs')],
        timeout: 10000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!).toContain('never completed the `initialize` handshake')
      expect(result.error!).toContain('package installer or build step')
    },
    60000,
  )

  it(
    'returns a clean "command not found" message for ENOENT',
    async () => {
      const result = await validateStdioMcpConnection({
        command: '/definitely/not/a/real/command-xyzzy',
        args: [],
        timeout: 3000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!).toContain('Command not found')
      expect(result.error!).toContain('command-xyzzy')
    },
    10000,
  )

  it(
    'surfaces stderr output when the server exits immediately',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: ['-e', "process.stderr.write('boom from test server\\n'); process.exit(1);"],
        timeout: 5000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.toLowerCase()).toContain('boom from test server')
    },
    15000,
  )
})
