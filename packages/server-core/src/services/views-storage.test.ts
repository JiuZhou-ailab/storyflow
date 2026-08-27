// input: Project roots containing ordinary paths, ancestor symlinks, or final-file symlinks
// output: Regression proof that views persistence never reads or writes outside the Project
// pos: Security boundary tests for views seeding, saving, and legacy smartLabels migration

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { loadViewsConfig, saveViewsConfig } from './views-storage'

describe('views storage project boundary', () => {
  it('does not seed views through a project state directory symlink', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'craft-views-project-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'craft-views-outside-'))
    symlinkSync(outsideRoot, join(projectRoot, '.craft-agent'), 'dir')

    try {
      expect(() => loadViewsConfig(projectRoot)).toThrow(/symbolic link/)
      expect(existsSync(join(outsideRoot, 'views.json'))).toBe(false)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('does not follow a broken views config symlink when saving', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'craft-views-project-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'craft-views-outside-'))
    const outsideConfig = join(outsideRoot, 'views.json')
    mkdirSync(join(projectRoot, '.craft-agent'))
    symlinkSync(outsideConfig, join(projectRoot, '.craft-agent', 'views.json'))

    try {
      expect(() => saveViewsConfig(projectRoot, { version: 1, views: [] }))
        .toThrow(/symbolic link/)
      expect(existsSync(outsideConfig)).toBe(false)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('does not rewrite legacy labels through a config symlink during migration', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'craft-views-project-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'craft-views-outside-'))
    const outsideLabels = join(outsideRoot, 'labels.json')
    const legacyConfig = JSON.stringify({
      smartLabels: [{ id: 'smart-review', name: 'Review', expression: 'status == "review"' }],
    })
    mkdirSync(join(projectRoot, '.craft-agent', 'labels'), { recursive: true })
    writeFileSync(outsideLabels, legacyConfig)
    symlinkSync(outsideLabels, join(projectRoot, '.craft-agent', 'labels', 'config.json'))

    try {
      loadViewsConfig(projectRoot)
      expect(readFileSync(outsideLabels, 'utf-8')).toBe(legacyConfig)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })
})
