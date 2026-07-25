// input: Root package version and optional release version environment
// output: Regression proof that release tags cannot diverge from packaged app versions
// pos: Release preflight coverage for scripts/check-version.ts

import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const rootDir = join(import.meta.dir, '..', '..')
const scriptPath = join(rootDir, 'scripts', 'check-version.ts')
const packageVersion = (
  JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { version: string }
).version
const [major, minor, patch] = packageVersion.split('.').map(Number)
const differentVersion = `${major}.${minor}.${patch + 1}`

function runCheck(releaseVersion: string) {
  return spawnSync('bun', ['run', scriptPath], {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      RELEASE_VERSION: releaseVersion,
    },
  })
}

describe('check-version release guard', () => {
  it('accepts a matching v-prefixed release version', () => {
    expect(runCheck(`v${packageVersion}`).status).toBe(0)
  })

  it('rejects a release version that differs from package manifests', () => {
    const result = runCheck(`v${differentVersion}`)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `Release version ${differentVersion} does not match package version ${packageVersion}.`,
    )
  })
})
