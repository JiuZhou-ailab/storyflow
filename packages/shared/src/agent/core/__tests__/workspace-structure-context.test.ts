// input: Temporary workspace directories with nested project files
// output: Regression coverage for bounded workspace structure prompt context
// pos: Guards the per-turn workspace structure anchor used by PromptBuilder

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildWorkspaceStructureSnapshot,
  renderWorkspaceStructureProjection,
} from '../workspace-structure-context'

describe('workspace structure context', () => {
  it('builds a bounded tree snapshot and renders it as a dedicated context field', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-workspace-structure-'))
    mkdirSync(join(rootPath, '正文'), { recursive: true })
    mkdirSync(join(rootPath, '自由区', '素材'), { recursive: true })
    mkdirSync(join(rootPath, 'node_modules', 'ignored-package'), { recursive: true })
    writeFileSync(join(rootPath, '创作要求.md'), 'requirements')
    writeFileSync(join(rootPath, '正文', '01-opening.md'), 'chapter')
    writeFileSync(join(rootPath, '自由区', '素材', '片段.md'), 'note')
    writeFileSync(join(rootPath, 'node_modules', 'ignored-package', 'index.js'), 'ignored')

    const snapshot = buildWorkspaceStructureSnapshot(rootPath, {
      maxDepth: 4,
      maxEntries: 20,
    })
    const projection = renderWorkspaceStructureProjection(snapshot, {
      activeWorkspaceRoot: rootPath,
      workingDirectory: rootPath,
    })

    expect(snapshot.rootPath).toBe(rootPath)
    expect(snapshot.truncated).toBe(false)
    expect(snapshot.entries.map(entry => entry.relativePath)).toContain('正文/')
    expect(snapshot.entries.map(entry => entry.relativePath)).toContain('正文/01-opening.md')
    expect(snapshot.entries.map(entry => entry.relativePath)).toContain('自由区/素材/片段.md')
    expect(snapshot.entries.map(entry => entry.relativePath)).not.toContain('node_modules/')
    expect(projection.data).toContain('<workspace_structure')
    expect(projection.data).toContain('active_workspace_root=')
    expect(projection.data).toContain('working_directory=')
    expect(projection.data).toContain('<tree>')
    expect(projection.data).toContain('创作要求.md')
    expect(projection.data).toContain('正文/')
    expect(projection.data).toContain('01-opening.md')
    expect(projection.data).toContain('</workspace_structure>')
    expect(projection.data).not.toContain('Do not invent paths from display names')
    expect(projection.policy).toContain('Do not invent paths from display names')
    expect(projection.policy).toContain('Durable project deliverables belong in workspace files')
    expect(projection.policy).toContain('Use chat for questions, clarification, progress, and summaries')
  })
})
