// input: Project files and a PromptBuilder turn
// output: Regression coverage for bounded workspace structure injection
// pos: Guards PromptBuilder runtime context for project sessions

import { describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PromptBuilder } from '../prompt-builder'

mock.module('../../../config/preferences.ts', () => ({
  formatPreferencesForPrompt: () => '',
}))

function createBuilder(rootPath: string): PromptBuilder {
  return new PromptBuilder({
    workspace: {
      id: 'workspace',
      name: 'Workspace',
      rootPath,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    } as never,
    session: {
      id: 'session',
      workspaceRootPath: rootPath,
      workingDirectory: rootPath,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    },
    systemPromptPreset: 'novel',
  })
}

describe('PromptBuilder project context', () => {
  it('injects a bounded workspace structure on every turn', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-workspace-state-'))
    mkdirSync(join(rootPath, '正文'), { recursive: true })
    mkdirSync(join(rootPath, 'node_modules', 'ignored-package'), { recursive: true })
    writeFileSync(join(rootPath, 'AGENTS.md'), 'project instructions')
    writeFileSync(join(rootPath, '创作要求.md'), 'requirements')
    writeFileSync(join(rootPath, '正文', '01-opening.md'), 'chapter')
    writeFileSync(join(rootPath, 'node_modules', 'ignored-package', 'index.js'), 'ignored')

    const builder = createBuilder(rootPath)
    const context = builder.buildContextParts({ userIteration: 7 }).join('\n\n')

    expect(context).toContain('<workspace_structure')
    expect(context).toContain(`active_workspace_root="${rootPath}"`)
    expect(context).toContain(`working_directory="${rootPath}"`)
    expect(context).toContain('<tree>')
    expect(context).toContain('创作要求.md')
    expect(context).toContain('正文/')
    expect(context).toContain('01-opening.md')
    expect(context).not.toContain('node_modules')
    expect(context).toContain('Do not invent paths from display names')
  })

  it('orders per-turn context from least to most volatile', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-prompt-order-'))
    writeFileSync(join(rootPath, 'AGENTS.md'), 'project instructions')
    const builder = createBuilder(rootPath)
    const context = builder.buildContextParts(
      { userIteration: 7 },
      '<sources>active source</sources>',
    ).join('\n\n')
    const markers = [
      '<workspace_root>',
      '<workspace_capabilities>',
      '<working_directory>',
      '<project_context_files',
      '<workspace_structure',
      '<sources>',
      '<session_state>',
      "**USER'S DATE AND TIME:",
    ]

    for (let index = 1; index < markers.length; index++) {
      expect(context.indexOf(markers[index - 1]!)).toBeLessThan(
        context.indexOf(markers[index]!),
      )
    }
  })
})
