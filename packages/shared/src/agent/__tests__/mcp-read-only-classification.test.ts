// input: Bundled default/source permissions plus MCP tool names
// output: Regression coverage for MCP read-only classification in safe and ask modes
// pos: Security contract — tool and server names must not grant read-only status by substring

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..')
const bundledResources = join(repoRoot, 'apps', 'electron', 'resources')
const modeManagerUrl = pathToFileURL(join(import.meta.dir, '..', 'mode-manager.ts')).href

type Case = { tool: string; sources?: string[] }

let parent: string
let configDir: string
let workspaceRoot: string

function copyInto(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}

/** Evaluate in a subprocess so CRAFT_CONFIG_DIR scopes the permissions cache. */
function classify(cases: Case[]): boolean[] {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `
      import { shouldAllowToolInMode } from '${modeManagerUrl}';
      const cases = ${JSON.stringify(cases)};
      const results = cases.map(({ tool, sources = [] }) =>
        shouldAllowToolInMode(tool, {}, 'safe', {
          permissionsContext: {
            workspaceRootPath: ${JSON.stringify(workspaceRoot)},
            activeSources: sources.map(slug => ({ slug, ownerRootPath: ${JSON.stringify(configDir)}, grantAuthority: 'host' })),
            allowProjectGrants: true,
          },
        }).allowed);
      console.log('MCP_RESULT=' + JSON.stringify(results));
    `,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  const match = run.stdout.toString().match(/MCP_RESULT=(\[.*\])/)
  if (!match) throw new Error(`Missing MCP result:\n${run.stdout.toString()}`)
  return JSON.parse(match[1]!)
}

beforeAll(() => {
  parent = mkdtempSync(join(tmpdir(), 'storyflow-mcp-read-only-'))
  configDir = join(parent, 'config')
  workspaceRoot = join(parent, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  copyInto(join(bundledResources, 'permissions', 'default.json'), join(configDir, 'permissions', 'default.json'))
  for (const slug of ['storyflow-catalog', 'wangwen-bigdata']) {
    copyInto(
      join(bundledResources, 'agent-defaults', 'sources', slug, 'permissions.json'),
      join(configDir, 'sources', slug, 'permissions.json'),
    )
  }
  mkdirSync(join(configDir, 'sources', 'tracker'), { recursive: true })
  writeFileSync(join(configDir, 'sources', 'tracker', 'permissions.json'), JSON.stringify({
    allowedMcpPatterns: [{ pattern: 'list' }],
  }))
  writeFileSync(join(workspaceRoot, 'permissions.json'), JSON.stringify({
    allowedMcpPatterns: [{ pattern: '^mcp__linear__(list|get)' }],
  }))
})

afterAll(() => {
  rmSync(parent, { recursive: true, force: true })
})

describe('MCP read-only classification', () => {
  it('blocks write tools whose name or server merely contains a read verb', () => {
    expect(classify([
      { tool: 'mcp__budget-targets__delete_target' },
      { tool: 'mcp__budget-targets__create_target' },
      { tool: 'mcp__db__execute_query' },
      { tool: 'mcp__tracker__blacklist_user', sources: ['tracker'] },
    ])).toEqual([false, false, false, false])
  })

  it('allows tools that start with a bundled read verb', () => {
    expect(classify([
      { tool: 'mcp__linear__list_issues' },
      { tool: 'mcp__linear__getIssue' },
      { tool: 'mcp__linear__search' },
      { tool: 'mcp__tracker__list_users', sources: ['tracker'] },
    ])).toEqual([true, true, true, true])
  })

  it('applies anchored Source rules to the bare tool name', () => {
    expect(classify([
      { tool: 'mcp__storyflow-catalog__short2api_health', sources: ['storyflow-catalog'] },
      { tool: 'mcp__storyflow-catalog__short2api_episode_detail', sources: ['storyflow-catalog'] },
      { tool: 'mcp__storyflow-catalog__short2api_purge_cache', sources: ['storyflow-catalog'] },
    ])).toEqual([true, true, false])
  })

  it('keeps query tools gated unless the Source declares them read-only', () => {
    expect(classify([
      { tool: 'mcp__db__query_rows' },
      { tool: 'mcp__wangwen-bigdata__query_rank', sources: ['wangwen-bigdata'] },
      { tool: 'mcp__wangwen-bigdata__execute_query', sources: ['wangwen-bigdata'] },
    ])).toEqual([false, true, false])
  })

  it('keeps full-name regex semantics for workspace rules', () => {
    expect(classify([
      { tool: 'mcp__linear__listall' },
      { tool: 'mcp__github__listall' },
    ])).toEqual([true, false])
  })

  it('requires a real token boundary in all-caps and mixed-case names', () => {
    expect(classify([
      { tool: 'mcp__x__COUNTER_INCREMENT' },
      { tool: 'mcp__x__READY_RESET' },
      { tool: 'mcp__x__LIST_ISSUES' },
      { tool: 'mcp__x__ListIssues' },
    ])).toEqual([false, false, true, true])
  })
})
