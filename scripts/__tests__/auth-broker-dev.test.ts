// input: Local auth broker dev script and desktop client auth environment
// output: Regression coverage for email-only local broker startup
// pos: Guards the Electron dev bootstrap path that supplies managed gateway credentials

import { afterEach, describe, expect, it } from 'bun:test'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT_DIR = join(import.meta.dir, '..', '..')
const PROCESSES: Array<ReturnType<typeof Bun.spawn>> = []

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate test port')))
        return
      }

      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

async function waitForHealth(port: number, proc: ReturnType<typeof Bun.spawn>): Promise<string | null> {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return null
    } catch {
      // The broker may still be starting.
    }

    const exitCode = await Promise.race([
      proc.exited,
      delay(50).then(() => null),
    ])
    if (exitCode !== null) {
      return `process exited with code ${exitCode}`
    }
  }

  return 'timed out waiting for /health'
}

async function readProcessOutput(proc: ReturnType<typeof Bun.spawn>): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : '',
    proc.stderr ? new Response(proc.stderr).text() : '',
  ])

  return [stdout, stderr].filter(Boolean).join('\n')
}

afterEach(async () => {
  while (PROCESSES.length > 0) {
    const proc = PROCESSES.pop()
    proc?.kill()
    await proc?.exited.catch(() => {})
  }
})

describe('auth-broker-dev', () => {
  it('starts with Neon Auth only when Feishu is not configured', async () => {
    const port = await getFreePort()
    const proc = Bun.spawn({
      cmd: [process.execPath, 'run', 'scripts/auth-broker-dev.ts'],
      cwd: ROOT_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        NO_COLOR: '1',
        CRAFT_CLIENT_AUTH_BROKER_URL: `http://127.0.0.1:${port}`,
        CRAFT_SERVER_TOKEN: 'test-server-token',
        CRAFT_WEBUI_NEON_AUTH_BASE_URL: 'https://ep-test.neonauth.aws.neon.build/neondb/auth',
        CRAFT_WEBUI_FEISHU_APP_ID: '',
        CRAFT_WEBUI_FEISHU_APP_SECRET: '',
        CRAFT_CLIENT_FEISHU_APP_ID: '',
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    PROCESSES.push(proc)

    const failure = await waitForHealth(port, proc)
    if (failure) {
      proc.kill()
      await proc.exited.catch(() => {})
    }

    expect(failure, failure ? await readProcessOutput(proc) : undefined).toBeNull()

    proc.kill()
    await proc.exited.catch(() => {})
    const output = await readProcessOutput(proc)
    expect(output).not.toContain('Gateway token mode')
  }, 15_000)
})
