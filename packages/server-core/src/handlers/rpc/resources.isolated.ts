// input: Resource import RPC, a portable Skill bundle, and temporary project/user/free-runtime roots
// output: Regression proof that explicit install scope and hidden runtime resolution select the only write root
// pos: Isolated transport-boundary check for Market and cross-workspace Skill installation

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { FREE_CONVERSATION_WORKSPACE_ID, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { ResourceBundle } from '@craft-agent/shared/resources'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'storyflow-resource-scope-'))
const userSkillsRoot = mkdtempSync(join(tmpdir(), 'storyflow-user-skills-'))
const credentialsModule = await import('@craft-agent/shared/credentials')

mock.module('@craft-agent/shared/workspaces', () => ({
  isFreeConversationWorkspaceId: (id: string) => id === FREE_CONVERSATION_WORKSPACE_ID,
  resolveRuntimeWorkspace: (id: string) => id === 'workspace-1' || id === FREE_CONVERSATION_WORKSPACE_ID
    ? { id, rootPath: workspaceRoot, name: 'Workspace' }
    : null,
  getWorkspaceSkillsPath: (rootPath: string) => join(rootPath, '.pi', 'skills'),
}))
mock.module('@craft-agent/shared/credentials', () => ({
  ...credentialsModule,
  SOURCE_CREDENTIAL_TYPES: [],
  getCredentialManager: () => ({ delete: async () => {} }),
}))
mock.module('@craft-agent/shared/skills', () => ({ getPiUserSkillsDir: () => userSkillsRoot }))

const { registerResourcesHandlers } = await import('./resources')

function createHarness(): {
  importResources: HandlerFn
  ctx: RequestContext
  pushedEvents: Array<{ channel: string, args: unknown[] }>
} {
  const handlers = new Map<string, HandlerFn>()
  const pushedEvents: Array<{ channel: string, args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel, _target, ...args) { pushedEvents.push({ channel, args }) },
    async invokeClient() { return undefined },
  }
  const deps = {
    sessionManager: {
      withProjectLifecycle: async (workspaceId: string, work: (workspace: { id: string; rootPath: string; name: string }) => Promise<unknown>) => {
        const workspace = workspaceId === 'workspace-1' || workspaceId === FREE_CONVERSATION_WORKSPACE_ID
          ? { id: workspaceId, rootPath: workspaceRoot, name: 'Workspace' }
          : null
        if (!workspace) throw new Error(`Project not found: ${workspaceId}`)
        return work(workspace)
      },
      notifyConfigFileChange: () => {},
    },
    oauthFlowStore: {},
    platform: {},
  } as unknown as HandlerDeps
  registerResourcesHandlers(server, deps)
  const importResources = handlers.get(RPC_CHANNELS.resources.IMPORT)
  if (!importResources) throw new Error('Resources import handler not registered')
  return {
    importResources,
    ctx: { clientId: 'client-1', workspaceId: 'workspace-1', webContentsId: 1 },
    pushedEvents,
  }
}

function skillBundle(slug: string): ResourceBundle {
  const content = `---\nname: ${slug}\ndescription: test\n---\n\nbody\n`
  const bytes = Buffer.from(content)
  return {
    version: 1,
    exportedAt: 1,
    resources: { skills: [{
      slug,
      files: [{ relativePath: 'SKILL.md', contentBase64: bytes.toString('base64'), size: bytes.byteLength }],
    }] },
  }
}

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(userSkillsRoot, { recursive: true, force: true })
})

describe('Resources Skill install scope', () => {
  it('requires scope and installs Market Skills into the selected project', async () => {
    const { importResources, ctx, pushedEvents } = createHarness()
    const bundle = skillBundle('market-skill')

    await expect(importResources(ctx, 'workspace-1', bundle, 'skip')).rejects.toThrow('explicit')
    await importResources(ctx, 'workspace-1', bundle, 'skip', { skillScope: 'project' })

    expect(existsSync(join(workspaceRoot, '.pi', 'skills', 'market-skill', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(userSkillsRoot, 'market-skill', 'SKILL.md'))).toBe(false)
    expect(pushedEvents).toContainEqual({
      channel: RPC_CHANNELS.skills.CHANGED,
      args: ['workspace-1'],
    })
  })

  it('installs Free Conversations Skills into Pi user scope', async () => {
    const { importResources, ctx, pushedEvents } = createHarness()

    await importResources(
      ctx,
      FREE_CONVERSATION_WORKSPACE_ID,
      skillBundle('free-market-skill'),
      'skip',
      { skillScope: 'project' },
    )

    expect(existsSync(join(workspaceRoot, '.pi', 'skills', 'free-market-skill', 'SKILL.md'))).toBe(false)
    expect(existsSync(join(userSkillsRoot, 'free-market-skill', 'SKILL.md'))).toBe(true)
    expect(pushedEvents).toContainEqual({
      channel: RPC_CHANNELS.skills.CHANGED,
      args: [FREE_CONVERSATION_WORKSPACE_ID],
    })
  })
})
