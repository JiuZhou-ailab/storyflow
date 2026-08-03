// input: Packaged desktop core E2E source
// output: Regression proof that its Git fixture preserves exact file bytes across platforms
// pos: Cross-platform release-gate contract for workspace version restore

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./run.ts', import.meta.url), 'utf8')

test('pins fixture line endings instead of weakening byte-exact restore checks', () => {
  expect(source).toContain("git(workspaceRoot, 'config', 'core.autocrlf', 'false')")
  expect(source).toContain("assert.equal(readFileSync(fixture.targetFile, 'utf8'), AGENT_EDIT)")
})
