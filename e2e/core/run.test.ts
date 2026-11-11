// input: Packaged desktop core E2E source
// output: Regression proof that its Git fixture preserves exact file bytes across platforms
// pos: Cross-platform release-gate contract for workspace version restore

import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const source = readFileSync(new URL('./run.ts', import.meta.url), 'utf8')

test('pins fixture line endings instead of weakening byte-exact restore checks', () => {
  expect(source).toContain("git(workspaceRoot, 'config', 'core.autocrlf', 'false')")
  expect(source).toContain("assert.equal(readFileSync(fixture.targetFile, 'utf8'), AGENT_EDIT)")
})

test('does not let a locked Windows temp directory overwrite the E2E result', () => {
  expect(source).toContain("process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EBUSY'")
})


test('preserves the failing stage and process output when launch never returns a handle', () => {
  const evidence = mkdtempSync(join(tmpdir(), 'storyflow-core-failure-'))
  try {
    // Bun is deliberately not Electron: it rejects the Chromium launch arguments.
    const result = spawnSync(process.execPath, ['e2e/core/run.ts'], {
      cwd: resolve(import.meta.dirname, '../..'),
      env: { ...process.env, CRAFT_E2E_ELECTRON_BIN: process.execPath, CRAFT_E2E_EVIDENCE_DIR: evidence },
      encoding: 'utf8', timeout: 15_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    const failure = JSON.parse(readFileSync(join(evidence, 'failure.json'), 'utf8'))
    expect(failure.stage).toBe('initial-launch')
    expect(failure.error.message).toContain('Electron exited before DevTools endpoint')
    expect(readFileSync(join(evidence, 'initial-launch-main.log'), 'utf8')).toContain('Launch failed:')
  } finally {
    rmSync(evidence, { recursive: true, force: true })
  }
}, 20_000)
