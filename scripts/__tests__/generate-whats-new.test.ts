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

  it('prefers curated release markdown when explicitly provided', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'storyflow-whats-new-'))
    const commitsJson = join(tmp, 'commits.json')
    const curatedNotes = join(tmp, 'next.md')
    const notesDir = join(tmp, 'release-notes')
    const manifestPath = join(tmp, 'whats-new.json')

    writeFileSync(commitsJson, JSON.stringify([
      { hash: 'a'.repeat(40), subject: 'feat: add update announcement dialog' },
      { hash: 'b'.repeat(40), subject: 'fix: preserve queued messages after redirect' },
      { hash: 'c'.repeat(40), subject: 'chore(release): bump version' },
    ]))
    writeFileSync(curatedNotes, [
      '# 最新动态',
      '',
      '这一版会在更新后弹出简短公告，告诉你本次更新了什么。',
      '',
      '## 本次更新',
      '',
      '- 新增更新公告弹窗',
      '- 修复排队消息跳转后的保留问题',
      '',
    ].join('\n'))

    const result = spawnSync('bun', [
      'run',
      scriptPath,
      '--version=0.9.27',
      `--commits-json=${commitsJson}`,
      `--curated-notes=${curatedNotes}`,
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

    const markdown = readFileSync(join(notesDir, '0.9.27.md'), 'utf8')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      summary: string
      source: {
        commitCount: number
        userVisibleCommitCount: number
      }
    }

    expect(markdown).toContain('新增更新公告弹窗')
    expect(manifest.summary).toBe('这一版会在更新后弹出简短公告，告诉你本次更新了什么。')
    expect(manifest.source.commitCount).toBe(3)
    expect(manifest.source.userVisibleCommitCount).toBe(2)
  })
})
