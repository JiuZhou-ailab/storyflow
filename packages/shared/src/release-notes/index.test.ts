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

  it('formats combined history with unique version headers when sources share 最新动态 titles', async () => {
    const cwd = process.cwd()
    const tmp = mkdtempSync(join(tmpdir(), 'storyflow-release-notes-history-'))
    tempDirs.push(tmp)
    const notesDir = join(tmp, 'resources', 'release-notes')
    mkdirSync(notesDir, { recursive: true })
    writeFileSync(join(notesDir, '1.2.0.md'), '# 最新动态\n\n- Feature A\n')
    writeFileSync(join(notesDir, '1.1.0.md'), '# 最新动态\n\n- Feature B\n')
    writeFileSync(join(notesDir, '1.0.0.md'), '# v1.0.0 — first\n\n- Feature C\n')
    writeFileSync(join(notesDir, 'next.md'), '# Scratch\n\n- Should be ignored\n')

    process.chdir(tmp)
    try {
      const releaseNotes = await import(`${moduleUrl}?history=${randomUUID()}`) as typeof import('./index')
      const combined = releaseNotes.getCombinedReleaseNotes()
      expect(combined).toContain('# v1.2.0')
      expect(combined).toContain('# v1.1.0')
      expect(combined).toContain('# v1.0.0')
      expect(combined).not.toContain('# 最新动态')
      expect(combined).not.toContain('Should be ignored')
      // Newest first
      expect(combined.indexOf('# v1.2.0')).toBeLessThan(combined.indexOf('# v1.1.0'))
      expect(combined.indexOf('# v1.1.0')).toBeLessThan(combined.indexOf('# v1.0.0'))
    } finally {
      process.chdir(cwd)
    }
  })

  it('stripLeadingMarkdownH1 removes only the first heading line', async () => {
    const releaseNotes = await import(`${moduleUrl}?strip=${randomUUID()}`) as typeof import('./index')
    expect(releaseNotes.stripLeadingMarkdownH1('# 最新动态\n\nbody\n')).toBe('body')
    expect(releaseNotes.stripLeadingMarkdownH1('no heading\n')).toBe('no heading')
    expect(releaseNotes.formatReleaseNoteForCombinedHistory('0.9.39', '# 最新动态\n\nhello')).toBe(
      '# v0.9.39\n\nhello',
    )
  })
})
