// input: Project files and a PromptBuilder turn
// output: Regression coverage for bounded workspace structure injection
// pos: Guards PromptBuilder runtime context for project sessions

import { describe, expect, it, mock, setSystemTime } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cleanupModeState, initializeModeState, setPermissionMode } from '../../mode-manager'
import { PromptBuilder } from '../prompt-builder'

mock.module('../../../config/preferences.ts', () => ({
  formatPreferencesForPrompt: () => '',
}))

function createBuilder(rootPath: string, workingDirectory = rootPath, sdkCwd?: string, localMcpEnabled = false): PromptBuilder {
  return new PromptBuilder({
    workspace: {
      id: 'workspace',
      localMcpEnabled,
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
  it('keeps policy stable across minutes while refreshing the current time data', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-prompt-time-'))
    const builder = createBuilder(rootPath)
    try {
      setSystemTime(new Date('2026-09-23T10:00:00Z'))
      const first = builder.buildTurnContext({})
      setSystemTime(new Date('2026-09-23T10:01:00Z'))
      const second = builder.buildTurnContext({})
      expect(second.system).toEqual(first.system)
      expect(second.data).not.toEqual(first.data)
      expect(second.data.join('\n')).toContain("**USER'S DATE AND TIME:")
    } finally {
      setSystemTime()
    }
  })

  it('keeps mode transitions and their one-time user signal in turn data', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-mode-policy-'))
    const builder = createBuilder(rootPath)
    initializeModeState('session', 'ask')
    try {
      const before = builder.buildTurnContext({})
      setPermissionMode('session', 'safe', { changedBy: 'user' })
      const changed = builder.buildTurnContext({})
      const following = builder.buildTurnContext({})
      expect(changed.system).toEqual(before.system)
      expect(following.system).toEqual(before.system)
      expect(changed.data.join('\n')).toContain('permissionMode: explore')
      expect(changed.data.join('\n')).toContain('modeChangeUserSignal:')
      expect(following.data.join('\n')).not.toContain('modeChangeUserSignal:')
    } finally { cleanupModeState('session') }
  })

  it('updates workspace capability facts without rewriting policy', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-capability-policy-'))
    const disabled = createBuilder(rootPath).buildTurnContext({})
    const enabled = createBuilder(rootPath, rootPath, undefined, true).buildTurnContext({})
    expect(enabled.system).toEqual(disabled.system)
    expect(disabled.data.join('\n')).toContain('project-local-mcp: disabled')
    expect(enabled.data.join('\n')).toContain('project-local-mcp: enabled')
  })

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
      '<workspace_capabilities>',
      '<working_directory>',
      '<project_context_files',
      '<workspace_structure',
      '<sources>',
      '<session_state>',
      '<session_paths>',
      "**USER'S DATE AND TIME:",
    ]
    const system = context.system.join('\n\n')
    const systemMarkers = [
      '<runtime_context_policy>',
      '<workspace_structure_policy>',
      '<source_policy>',
      '<session_state_policy>',
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
    expect(system).not.toContain("**USER'S DATE AND TIME:")
    expect(data).not.toContain('<language_policy_reminder>')
  })
})
