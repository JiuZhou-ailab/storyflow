// input: Existing workspace config plus a legacy writing manifest and user files
// output: Regression coverage for read-only legacy project compatibility
// pos: Prevents workspace loading from repairing or rewriting project content

import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectManifestWritingProject } from '../../writing/manifest.ts'
import { createWorkspaceAtPath, loadWorkspaceConfig } from '../storage.ts'

describe('legacy writing workspace loading', () => {
  it('reads the old project type while ignoring Method Pack metadata', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-legacy-writing-read-'))
    const manifestPath = join(rootPath, '.craft-agent', 'craft-writing.json')

    try {
      createWorkspaceAtPath(rootPath, 'Legacy Project')
      writeFileSync(manifestPath, JSON.stringify({
        schemaVersion: 1,
        type: 'short-form',
        title: 'Legacy Project',
        methodPack: { id: 'short-form.article', version: 1 },
      }, null, 2))

      expect(detectManifestWritingProject(rootPath)?.manifest).toEqual({
        schemaVersion: 1,
        type: 'short-form',
        title: 'Legacy Project',
      })
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('does not recreate missing scaffold paths or rewrite project content on load', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-legacy-writing-no-repair-'))
    const manifestPath = join(rootPath, '.craft-agent', 'craft-writing.json')
    const userFilePath = join(rootPath, '正文', '保留.md')
    const missingLegacyPath = join(rootPath, '全局', '大纲.md')

    try {
      createWorkspaceAtPath(rootPath, 'Legacy Project', { workingDirectory: rootPath })
      mkdirSync(join(rootPath, '正文'), { recursive: true })
      writeFileSync(userFilePath, '# 用户内容\n')
      writeFileSync(manifestPath, JSON.stringify({
        schemaVersion: 1,
        type: 'short-form',
        methodPack: { id: 'short-form.article', version: 1 },
      }, null, 2))
      const manifestBefore = readFileSync(manifestPath, 'utf8')
      const userContentBefore = readFileSync(userFilePath, 'utf8')

      expect(loadWorkspaceConfig(rootPath)?.name).toBe('Legacy Project')
      expect(existsSync(missingLegacyPath)).toBe(false)
      expect(existsSync(join(rootPath, '.pi'))).toBe(false)
      expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore)
      expect(readFileSync(userFilePath, 'utf8')).toBe(userContentBefore)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })
})
