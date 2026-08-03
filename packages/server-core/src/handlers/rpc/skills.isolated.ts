// input: Registered Skills RPC handlers, a non-ASCII Pi Skill name, and a temporary Skill directory
// output: Regression proof that deletion and export use Pi's resolved catalog identity and path
// pos: Isolated transport-boundary guard; module mocks must not leak into the shared test process

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRootPath = ''
let catalogSkill: {
  slug: string
  metadata: { name: string; description: string }
  content: string
  path: string
  filePath: string
  scope: 'user' | 'project'
  source: string
  origin: 'top-level'
} | null = null
let invalidated = false

mock.module('@craft-agent/shared/workspaces', () => ({
  resolveRuntimeWorkspace: (id: string) => id === 'workspace-1'
    ? {
        id,
        name: 'Workspace',
        rootPath: workspaceRootPath,
        slug: 'workspace',
        createdAt: 0,
      }
    : null,
}))

mock.module('@craft-agent/shared/skills', () => ({
  isValidSkillSlug: (slug: string) => /^[a-z0-9-]+$/.test(slug),
  loadPiSkillCatalog: async () => ({
    skills: catalogSkill ? [catalogSkill] : [],
    diagnostics: [],
  }),
  invalidateSkillsCache: () => {
    invalidated = true
  },
}))

const { registerSkillsHandlers } = await import('./skills')

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
  }
  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  }
  registerSkillsHandlers(server, deps)

  const deleteSkill = handlers.get(RPC_CHANNELS.skills.DELETE)
  const exportSkill = handlers.get(RPC_CHANNELS.skills.EXPORT)
  if (!deleteSkill) throw new Error('Skills delete handler not registered')
  if (!exportSkill) throw new Error('Skills export handler not registered')

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: 'workspace-1',
    webContentsId: 1,
  }
  return { deleteSkill, exportSkill, ctx }
}

afterEach(() => {
  if (workspaceRootPath) rmSync(workspaceRootPath, { recursive: true, force: true })
  workspaceRootPath = ''
  catalogSkill = null
  invalidated = false
})

describe('Skills RPC catalog identity', () => {
  it('deletes a top-level Skill whose Pi name is not a filesystem slug', async () => {
    workspaceRootPath = mkdtempSync(join(tmpdir(), 'storyflow-skill-delete-'))
    const skillPath = join(workspaceRootPath, '.agents', 'skills', 'plot-causality-audit')
    const filePath = join(skillPath, 'SKILL.md')
    mkdirSync(skillPath, { recursive: true })
    writeFileSync(filePath, '---\nname: 剧情因果审查\ndescription: test\n---\n')
    catalogSkill = {
      slug: '剧情因果审查',
      metadata: { name: '剧情因果审查', description: 'test' },
      content: '',
      path: skillPath,
      filePath,
      scope: 'user',
      source: 'auto',
      origin: 'top-level',
    }
    const { deleteSkill, ctx } = createHarness()

    await deleteSkill(ctx, 'workspace-1', '剧情因果审查')

    expect(existsSync(skillPath)).toBe(false)
    expect(invalidated).toBe(true)
  })

  it('exports the resolved project Skill by its real directory slug', async () => {
    workspaceRootPath = mkdtempSync(join(tmpdir(), 'storyflow-skill-export-'))
    const projectRoot = join(workspaceRootPath, 'novel')
    const skillPath = join(projectRoot, '.agents', 'skills', 'plot-causality-audit')
    const filePath = join(skillPath, 'SKILL.md')
    mkdirSync(skillPath, { recursive: true })
    writeFileSync(filePath, '---\nname: 剧情因果审查\ndescription: test\n---\n\n正文\n')
    catalogSkill = {
      slug: '剧情因果审查',
      metadata: { name: '剧情因果审查', description: 'test' },
      content: '正文',
      path: skillPath,
      filePath,
      scope: 'project',
      source: 'auto',
      origin: 'top-level',
    }
    const { exportSkill, ctx } = createHarness()

    const result = await exportSkill(ctx, 'workspace-1', '剧情因果审查', projectRoot) as {
      bundle: { resources: { skills?: Array<{ slug: string }> } }
    }

    expect(result.bundle.resources.skills).toHaveLength(1)
    expect(result.bundle.resources.skills?.[0]?.slug).toBe('plot-causality-audit')
  })
})
