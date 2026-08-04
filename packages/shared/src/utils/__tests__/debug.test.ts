// input: Shared CLI logger and a debug-enabled Bun subprocess
// output: Regression proof for one timestamp and preserved log severity
// pos: Guards the transport boundary against duplicate formatting and flattened levels

import { describe, expect, it } from 'bun:test'

describe('shared debug logger', () => {
  it('formats a CLI warning once with its real level', async () => {
    const debugModule = new URL('../debug.ts', import.meta.url).href
    const child = Bun.spawn([
      process.execPath,
      '-e',
      `import { createLogger } from ${JSON.stringify(debugModule)}; createLogger('probe').warn('careful', { count: 2 })`,
    ], {
      env: { ...process.env, CRAFT_DEBUG: '1', CRAFT_CLI_JSON_ONLY: '0' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stderr = await new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    expect(stderr).toMatch(/^\d{4}-\d{2}-\d{2}T[^ ]+ WARN {1,2}\[probe\] careful \{"count":2\}\n$/)
    expect(stderr.match(/\d{4}-\d{2}-\d{2}T/g)).toHaveLength(1)
  })

  it('delegates raw arguments to the matching Electron level', async () => {
    const debugModule = new URL('../debug.ts', import.meta.url).href
    const child = Bun.spawn([
      process.execPath,
      '-e',
      `
        import { mock } from 'bun:test'
        const calls = []
        mock.module('electron-log/main', () => ({
          default: {
            scope: name => ({
              debug: (...args) => calls.push({ level: 'debug', name, args }),
              info: (...args) => calls.push({ level: 'info', name, args }),
              warn: (...args) => calls.push({ level: 'warn', name, args }),
              error: (...args) => calls.push({ level: 'error', name, args }),
            }),
          },
        }))
        Object.defineProperty(process, 'type', { value: 'browser' })
        const { createLogger } = await import(${JSON.stringify(debugModule)})
        createLogger('probe').warn('careful', { count: 2 })
        console.log(JSON.stringify(calls))
      `,
    ], {
      env: { ...process.env, CRAFT_DEBUG: '1', CRAFT_CLI_JSON_ONLY: '0' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(child.stdout).text()
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual([
      { level: 'warn', name: 'probe', args: ['careful', { count: 2 }] },
    ])
  })
})
