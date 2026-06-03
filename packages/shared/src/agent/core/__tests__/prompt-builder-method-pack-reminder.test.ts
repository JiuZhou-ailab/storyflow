// input: Writing workspace method-pack metadata and per-message iteration counts
// output: Regression coverage for dynamic periodic reminder injection
// pos: Guards PromptBuilder runtime context for sustained writing sessions

import { describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createNovelProjectScaffold } from '../../../writing/novel-template'
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

describe('PromptBuilder writing profile context', () => {
  it('does not inject method-pack periodic reminders', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-profile-reminder-'))
    createNovelProjectScaffold(rootPath, {
      title: 'Short Form Reminder',
      methodPackId: 'short-form.article',
    })
    const builder = createBuilder(rootPath)

    const secondTurn = builder.buildContextParts({ userIteration: 2 }).join('\n\n')
    const fourthTurn = builder.buildContextParts({ userIteration: 4 }).join('\n\n')

    expect(secondTurn).not.toContain('<method_pack_periodic_reminder')
    expect(fourthTurn).not.toContain('<method_pack_periodic_reminder')
  })

  it('injects a bounded workspace structure on every turn', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-workspace-state-'))
    mkdirSync(join(rootPath, '正文'), { recursive: true })
    mkdirSync(join(rootPath, 'node_modules', 'ignored-package'), { recursive: true })
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
})
