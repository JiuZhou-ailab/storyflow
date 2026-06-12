// input: Bundled release note markdown and structured What's New manifest assets
// output: Runtime release-note manifest resolution coverage
// pos: Ensures update announcements use release-time structured copy when available

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const repoRoot = join(import.meta.dir, '..', '..', '..', '..')
const moduleUrl = pathToFileURL(join(repoRoot, 'packages/shared/src/release-notes/index.ts')).href
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('release notes runtime manifest', () => {
  it('prefers bundled whats-new.json over markdown-derived fallback copy', async () => {
    const cwd = process.cwd()
    const tmp = mkdtempSync(join(tmpdir(), 'storyflow-release-notes-'))
    tempDirs.push(tmp)
    const notesDir = join(tmp, 'resources', 'release-notes')
    mkdirSync(notesDir, { recursive: true })
    writeFileSync(join(notesDir, '9.9.9.md'), [
      '# v9.9.9',
      '',
      'Markdown fallback summary.',
      '',
      '- Markdown fallback highlight',
      '',
    ].join('\n'))
    writeFileSync(join(notesDir, 'whats-new.json'), `${JSON.stringify({
      version: '9.9.9',
      digest: 'structured-digest',
      generatedAt: '2026-06-12T00:00:00.000Z',
      title: 'Structured update announcement',
      summary: 'Structured announcement summary.',
      highlights: ['Structured highlight'],
      accentColor: '#2563eb',
      accentTextColor: '#ffffff',
      source: {
        commitCount: 2,
        userVisibleCommitCount: 1,
      },
    }, null, 2)}\n`)

    process.chdir(tmp)
    try {
      const releaseNotes = await import(`${moduleUrl}?case=${randomUUID()}`) as typeof import('./index')
      expect(releaseNotes.getLatestWhatsNewManifest()).toMatchObject({
        version: '9.9.9',
        digest: 'structured-digest',
        summary: 'Structured announcement summary.',
        highlights: ['Structured highlight'],
      })
    } finally {
      process.chdir(cwd)
    }
  })
})
