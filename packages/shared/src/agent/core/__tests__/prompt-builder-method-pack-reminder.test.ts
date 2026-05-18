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

describe('PromptBuilder method pack periodic reminders', () => {
  it('injects short-form method-pack reminders on the configured user-message cadence', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-method-reminder-'))
    createNovelProjectScaffold(rootPath, {
      title: 'Short Form Reminder',
      methodPackId: 'short-form.article',
    })
    const builder = createBuilder(rootPath)

    const firstTurn = builder.buildContextParts({ userIteration: 1 }).join('\n\n')
    const secondTurn = builder.buildContextParts({ userIteration: 2 }).join('\n\n')
    const thirdTurn = builder.buildContextParts({ userIteration: 3 }).join('\n\n')
    const fourthTurn = builder.buildContextParts({ userIteration: 4 }).join('\n\n')

    expect(firstTurn).not.toContain('<method_pack_periodic_reminder')
    expect(secondTurn).toContain('<method_pack_periodic_reminder id="short-form.article"')
    expect(secondTurn).toContain('iteration="2"')
    expect(secondTurn).toContain('interval="2"')
    expect(secondTurn).toContain('user messages')
    expect(secondTurn).toContain('人物动机')
    expect(thirdTurn).not.toContain('<method_pack_periodic_reminder')
    expect(fourthTurn).toContain('<method_pack_periodic_reminder id="short-form.article"')
  })
})
