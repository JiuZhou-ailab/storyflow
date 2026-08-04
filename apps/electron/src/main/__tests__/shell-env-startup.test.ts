// input: The shell-environment loader module and the main-process runtime wiring
// output: Regression coverage for deferred login-shell discovery and bundled PATH preservation
// pos: Guards the startup ordering that makes the first session/search RPC fast

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const mainSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const shellEnvSource = readFileSync(new URL('../shell-env.ts', import.meta.url), 'utf8')

describe('shell environment startup ordering', () => {
  it('starts login-shell discovery without blocking session discovery', () => {
    // Awaiting loadShellEnv() here serialized an interactive login shell (~1-2s of
    // user dotfiles) in front of SessionManager.initialize(), which gates every
    // session and search RPC. Session discovery reads JSONL and needs no PATH.
    expect(mainSource).toContain('startShellEnvLoad()')
    expect(mainSource).not.toMatch(/await\s+loadShellEnv\(\)/)
    expect(mainSource).toMatch(/startShellEnvLoad\(\)\s*\n\s*await sm\.initialize\(\)/)
  })

  it('still guarantees the environment before agent subprocesses spawn', () => {
    // Deferring the load is only safe because agent creation awaits it.
    expect(mainSource).toContain('whenSubprocessEnvReady: whenShellEnvReady')
  })

  it('loads the shell exactly once across concurrent callers', () => {
    expect(shellEnvSource).toMatch(/shellEnvLoad \?\?= loadShellEnv\(\)/)
    expect(shellEnvSource).toContain('export function whenShellEnvReady')
  })

  it('keeps bundled tool paths when merging the login-shell PATH', () => {
    expect(shellEnvSource).toContain("key === 'PATH' && process.env.PATH")
    expect(shellEnvSource).toContain('`${process.env.PATH}:${value}`')
  })
})
