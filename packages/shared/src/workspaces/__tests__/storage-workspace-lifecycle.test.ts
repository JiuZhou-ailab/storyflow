// input: Generic/default workspace creators plus legacy host-state layouts
// output: Regression coverage for blank roots and host-state migration
// pos: Shared storage guard for project creation and existing workspace loading

import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDefaultWorkspaceAtPath,
  createWorkspaceAtPath,
  generateSlug,
  loadWorkspaceConfig,
} from '../storage.ts'
import { getWorkspaceSkillsPath } from '../paths.ts'

function statePath(rootPath: string, relativePath = ''): string {
  return join(rootPath, '.craft-agent', relativePath)
}

describe('blank workspace creation', () => {
  it('creates a blank workspace rooted at the selected project folder', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-blank-workspace-'))

    try {
      const config = createWorkspaceAtPath(rootPath, 'Blank Workspace')

      expect(config.defaults?.workingDirectory).toBe(rootPath)
      expect(readdirSync(rootPath).filter(entry => !entry.startsWith('.'))).toEqual([])
      expect(existsSync(join(rootPath, '.git'))).toBe(false)
      expect(existsSync(join(rootPath, '.pi'))).toBe(false)
      expect(existsSync(statePath(rootPath, 'craft-writing.json'))).toBe(false)
      expect(existsSync(statePath(rootPath, 'craft-pack-lock.json'))).toBe(false)
      expect(existsSync(statePath(rootPath, 'migrations/project-skills.json'))).toBe(false)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('uses the same blank contract for the product default workspace', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-default-workspace-'))

    try {
      const config = createDefaultWorkspaceAtPath(rootPath)

      expect(config.name).toBe('我的项目')
      expect(config.defaults?.workingDirectory).toBe(rootPath)
      expect(readdirSync(rootPath).filter(entry => !entry.startsWith('.'))).toEqual([])
      expect(existsSync(join(rootPath, '.pi'))).toBe(false)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })

  it('generates a stable non-empty slug for non-ASCII workspace names', () => {
    expect(generateSlug('九州小说')).toMatch(/^workspace-[a-z0-9]+$/)
  })
})

describe('legacy workspace host-state migration', () => {
  it('moves old host files under .craft-agent without moving project content', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-legacy-state-workspace-'))
    const now = Date.now()

    try {
      mkdirSync(join(rootPath, 'sessions', '260703-legacy'), { recursive: true })
      mkdirSync(join(rootPath, 'skills', 'legacy-custom-skill'), { recursive: true })
      mkdirSync(join(rootPath, 'labels'), { recursive: true })
      mkdirSync(join(rootPath, 'statuses', 'icons'), { recursive: true })
      mkdirSync(join(rootPath, '.claude-plugin'), { recursive: true })
      mkdirSync(join(rootPath, '全局'), { recursive: true })
      mkdirSync(statePath(rootPath, 'sessions/260703-current'), { recursive: true })

      writeFileSync(join(rootPath, 'config.json'), JSON.stringify({
        id: 'ws_legacy',
        name: 'Legacy Short',
        slug: 'legacy-short',
        defaults: {},
        createdAt: now,
        updatedAt: now,
      }, null, 2))
      writeFileSync(join(rootPath, 'craft-writing.json'), JSON.stringify({
        schemaVersion: 1,
        type: 'short-form',
        title: 'Legacy Short',
      }, null, 2))
      writeFileSync(join(rootPath, 'AGENTS.md'), '# Agent\n')
      writeFileSync(join(rootPath, 'sessions', '260703-legacy', 'session.jsonl'), '{}\n')
      writeFileSync(statePath(rootPath, 'sessions/260703-current/session.jsonl'), '{}\n')
      writeFileSync(join(rootPath, 'skills', 'legacy-custom-skill', 'SKILL.md'), '# Skill\n')
      writeFileSync(join(rootPath, '.claude-plugin', 'plugin.json'), '{"name":"craft-workspace-legacy"}\n')
      writeFileSync(join(rootPath, '全局', '简报.md'), '# 简报\n')

      const config = loadWorkspaceConfig(rootPath)

      expect(config?.name).toBe('Legacy Short')
      expect(existsSync(join(rootPath, 'config.json'))).toBe(false)
      expect(existsSync(join(rootPath, 'craft-writing.json'))).toBe(false)
      expect(existsSync(join(rootPath, 'AGENTS.md'))).toBe(false)
      expect(existsSync(statePath(rootPath, 'config.json'))).toBe(true)
      expect(existsSync(statePath(rootPath, 'craft-writing.json'))).toBe(true)
      expect(existsSync(statePath(rootPath, 'AGENTS.md'))).toBe(true)
      expect(existsSync(statePath(rootPath, 'sessions/260703-legacy/session.jsonl'))).toBe(true)
      expect(existsSync(statePath(rootPath, 'sessions/260703-current/session.jsonl'))).toBe(true)
      expect(readFileSync(join(rootPath, 'skills/legacy-custom-skill/SKILL.md'), 'utf8')).toBe('# Skill\n')
      expect(existsSync(getWorkspaceSkillsPath(rootPath))).toBe(false)
      expect(existsSync(statePath(rootPath, 'claude-plugin/plugin.json'))).toBe(true)
      expect(readFileSync(join(rootPath, '全局', '简报.md'), 'utf8')).toBe('# 简报\n')
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })
})
