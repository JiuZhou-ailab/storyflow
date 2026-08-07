// input: Storyflow prompt options and user preference stubs
// output: Regression coverage for runtime guidance and prompt policy
// pos: Contract tests for the central Storyflow system prompt

import { describe, it, expect, mock, beforeEach } from 'bun:test'

// Stub the preferences module so we can toggle `getCoAuthorPreference` per test
// without touching disk. `formatPreferencesForPrompt` is stubbed to '' because
// it's unrelated to the behavior under test here.
let mockIncludeCoAuthoredBy = true
mock.module('../../config/preferences.ts', () => ({
  getCoAuthorPreference: () => mockIncludeCoAuthoredBy,
  formatPreferencesForPrompt: () => '',
}))

import { getSystemPrompt } from '../system'

const GIT_CONVENTIONS_HEADING = '## Git Conventions'
const CO_AUTHOR_TRAILER = 'Co-Authored-By: Storyflow <agents-noreply@craft.do>'

describe('system prompt guidance', () => {
  it('identifies as Storyflow without exposing internal runtime branding', () => {
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      'INTERNAL BACKEND',
      false,
    )

    expect(prompt).toContain('You are Storyflow')
    expect(prompt).toContain('Storyflow is the product identity')
    expect(prompt).not.toContain('INTERNAL BACKEND')
    expect(prompt).not.toContain('powered by')
    expect(prompt).not.toContain('<craft_agent_environment')
  })

  it('injects the selected language and human-visible naming contract', () => {
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      'zh-Hans',
    )

    expect(prompt).toContain('使用简体中文回答')
    expect(prompt).toContain('创建或重命名用户可见的文件、文件夹')
  })

  it('uses backend-neutral debug log querying guidance (rg/grep via Bash)', () => {
    const prompt = getSystemPrompt(
      undefined,
      { enabled: true, logFilePath: '/tmp/main.log' },
      '/tmp/workspace',
      '/tmp/workspace'
    )

    expect(prompt).toContain('Use Bash with `rg`/`grep` to search logs efficiently:')
    expect(prompt).toContain('rg -n "session" "/tmp/main.log"')
    expect(prompt).not.toContain('Use the Grep tool (if available)')
    expect(prompt).not.toContain('Grep pattern=')
  })

  it('describes the real call_llm boundary without advertising unregistered agent tools', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('`call_llm` cannot use them; handle it with the current agent')
    expect(prompt).not.toContain('Task tool')
    expect(prompt).not.toContain('Task (subagents)')
    expect(prompt).not.toContain('Task = full agent')
  })

  it('keeps session data temporary and durable deliverables in the workspace', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('it is not the destination for user-requested project files')
    expect(prompt).toContain('Durable deliverables belong in the current working directory')
    expect(prompt).toContain('write durable project deliverables to the current working directory')
    expect(prompt).toContain('use `SubmitPlan` only when the plan is ready')
    expect(prompt).not.toContain('`update_plan`')
    expect(prompt).not.toContain('data files to the **exact `dataFolderPath`**')
  })

  it('uses the typed web_search capability for routine search', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('Use the built-in `web_search` tool as the default')
    expect(prompt).toContain('Do not run the AnySearch CLI for routine web searches')
    expect(prompt).toContain('never through `script_sandbox`')
    expect(prompt).toContain('user Skills from `~/.pi/agent/skills` and `~/.agents/skills`')
    expect(prompt).toContain('project Skills from `.pi/skills` and `.agents/skills`')
  })

  it('keeps static guidance below the fixed-context budget', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt.length).toBeLessThan(7_000)
  })

  it('keeps workspace-specific paths out of the stable prefix', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).not.toContain('/tmp/workspace')
    expect(prompt).toContain('workspace root at `.craft-agent/sources/{slug}/`')
    expect(prompt).not.toContain('<project_context_files working_directory=')
  })
})

describe('includeCoAuthoredBy handling', () => {
  beforeEach(() => {
    mockIncludeCoAuthoredBy = true
  })

  it('includes the Git Conventions block when the arg is explicitly true', () => {
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      undefined,
      true
    )

    expect(prompt).toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).toContain(CO_AUTHOR_TRAILER)
  })

  it('omits the Git Conventions block when the arg is explicitly false', () => {
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      undefined,
      false
    )

    expect(prompt).not.toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).not.toContain(CO_AUTHOR_TRAILER)
  })

  // Regression test for #576: Pi-backed sessions called getSystemPrompt without
  // the 7th arg, and the function silently defaulted to `true`, ignoring the
  // user's preference. The defensive fallback in getSystemPrompt should now
  // resolve to getCoAuthorPreference() when the arg is omitted.
  it('falls back to getCoAuthorPreference() when the arg is omitted (#576)', () => {
    mockIncludeCoAuthoredBy = false

    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      'Storyflow Backend'
      // 7th arg omitted — must not regress to `true` default
    )

    expect(prompt).not.toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).not.toContain(CO_AUTHOR_TRAILER)
  })

  it('falls back to getCoAuthorPreference() === true when the arg is omitted and the user has not opted out', () => {
    mockIncludeCoAuthoredBy = true

    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace'
    )

    expect(prompt).toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).toContain(CO_AUTHOR_TRAILER)
  })
})
