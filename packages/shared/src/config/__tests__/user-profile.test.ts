// input: temporary Craft Agent config directory with optional USER.md content
// output: regression coverage for user profile prompt injection
// pos: validates the user-authored Markdown context layer

import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

const PREFERENCES_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'preferences.ts')).href

function makeConfigDir(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-user-profile-'))
}

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { formatPreferencesForPrompt } from '${PREFERENCES_MODULE_PATH}'; ${code}`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }

  return run.stdout.toString().trim()
}

describe('user profile prompt formatting', () => {
  it('includes USER.md content even when structured preferences are empty', () => {
    const configDir = makeConfigDir()
    writeFileSync(join(configDir, 'USER.md'), '# Identity\n\nI prefer concise Chinese answers.', 'utf-8')

    const output = runEval(configDir, 'console.log(formatPreferencesForPrompt())')

    expect(output).toContain('## User Profile')
    expect(output).toContain('I prefer concise Chinese answers.')
  })
})
