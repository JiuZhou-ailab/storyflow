// input: Temporary commit metadata files and output directories
// output: Regression coverage for the release-time What's New generator script
// pos: Prevents release automation from shipping without generated user-facing update notes

import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const rootDir = join(import.meta.dir, '..', '..')
const scriptPath = join(rootDir, 'scripts', 'generate-whats-new.ts')

describe('generate-whats-new', () => {
  it('writes release markdown and manifest from commit metadata', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'storyflow-whats-new-'))
    const commitsJson = join(tmp, 'commits.json')
    const notesDir = join(tmp, 'release-notes')
    const manifestPath = join(tmp, 'whats-new.json')

    writeFileSync(commitsJson, JSON.stringify([
      { hash: 'a'.repeat(40), subject: 'feat: add guided profile setup' },
      { hash: 'b'.repeat(40), subject: 'fix: preserve queued messages after redirect' },
    ]))

    const result = spawnSync('bun', [
      'run',
      scriptPath,
      '--version=0.9.26',
      `--commits-json=${commitsJson}`,
      `--out-dir=${notesDir}`,
      `--out-json=${manifestPath}`,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        STORYFLOW_WHATS_NEW_DISABLE_AI: '1',
      },
    })

    expect(result.status).toBe(0)
    expect(existsSync(join(notesDir, '0.9.26.md'))).toBe(true)
    expect(existsSync(manifestPath)).toBe(true)

    const markdown = readFileSync(join(notesDir, '0.9.26.md'), 'utf8')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: string
      digest: string
      accentColor: string
    }

    expect(markdown).toContain('Guided profile setup')
    expect(markdown).toContain('Preserve queued messages after redirect')
    expect(manifest.version).toBe('0.9.26')
    expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.accentColor).toMatch(/^#[0-9a-f]{6}$/)
  })
})
