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

function createBuilder(rootPath: string, workingDirectory = rootPath, sdkCwd?: string): PromptBuilder {
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
      workingDirectory,
      sdkCwd,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    },
    systemPromptPreset: 'novel',
  })
}

describe('PromptBuilder project context', () => {
  it('treats the selected Pi cwd as effective instead of legacy sdkCwd metadata', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-prompt-sdk-cwd-'))
    const workingDirectory = mkdtempSync(join(tmpdir(), 'craft-prompt-pi-cwd-'))
    const context = createBuilder(rootPath, workingDirectory, rootPath).getWorkingDirectoryContext()

    expect(context).toContain(`<working_directory>${workingDirectory}</working_directory>`)
    expect(context).not.toContain('bash shell runs from a different directory')
    expect(context).not.toContain(rootPath)
  })

  it('injects a bounded workspace structure on every turn', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-workspace-state-'))
    mkdirSync(join(rootPath, '正文'), { recursive: true })
    mkdirSync(join(rootPath, 'node_modules', 'ignored-package'), { recursive: true })
    writeFileSync(join(rootPath, 'AGENTS.md'), 'project instructions')
    writeFileSync(join(rootPath, '创作要求.md'), 'requirements')
    writeFileSync(join(rootPath, '正文', '01-opening.md'), 'chapter')
    writeFileSync(join(rootPath, 'node_modules', 'ignored-package', 'index.js'), 'ignored')

    const builder = createBuilder(rootPath)
    const projection = builder.buildTurnContext({ userIteration: 7 })
    const context = projection.data.join('\n\n')
    const policy = projection.system.join('\n\n')

    expect(context).toContain('<workspace_structure')
    expect(context).toContain(`active_workspace_root="${rootPath}"`)
    expect(context).toContain(`working_directory="${rootPath}"`)
    expect(context).toContain('<tree>')
    expect(context).toContain('创作要求.md')
    expect(context).toContain('正文/')
    expect(context).toContain('01-opening.md')
    expect(context).not.toContain('node_modules')
    expect(context).not.toContain('Do not invent paths from display names')
    expect(policy).toContain('Do not invent paths from display names')
  })

  it('separates host policy from turn data', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-prompt-order-'))
    writeFileSync(join(rootPath, 'AGENTS.md'), 'project instructions')
    const builder = createBuilder(rootPath)
    const context = builder.buildTurnContext(
      { userIteration: 7 },
      {
        policy: '<source_policy>read guide first</source_policy>',
        data: '<sources>active source</sources>',
      },
    )
    const data = context.data.join('\n\n')
    const dataMarkers = [
      '<workspace_root>',
      '<working_directory>',
      '<project_context_files',
      '<workspace_structure',
      '<sources>',
      '<session_paths>',
    ]
    const system = context.system.join('\n\n')
    const systemMarkers = [
      '<workspace_capabilities>',
      '<workspace_structure_policy>',
      '<source_policy>',
      '<session_state>',
      "**USER'S DATE AND TIME:",
      '<language_policy_reminder>',
    ]

    for (let index = 1; index < dataMarkers.length; index++) {
      expect(data.indexOf(dataMarkers[index - 1]!)).toBeLessThan(
        data.indexOf(dataMarkers[index]!),
      )
    }
    for (let index = 1; index < systemMarkers.length; index++) {
      expect(system.indexOf(systemMarkers[index - 1]!)).toBeLessThan(
        system.indexOf(systemMarkers[index]!),
      )
    }
    expect(system).not.toContain(rootPath)
    expect(data).not.toContain('<language_policy_reminder>')
  })
})
