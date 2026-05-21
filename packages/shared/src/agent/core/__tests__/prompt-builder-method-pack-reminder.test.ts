// input: Writing workspace method-pack metadata and per-message iteration counts
// output: Regression coverage for dynamic periodic reminder injection
// pos: Guards PromptBuilder runtime context for sustained writing sessions

import { describe, expect, it, mock } from 'bun:test'
import { mkdtempSync } from 'fs'
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
})
