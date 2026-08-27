// input: Source RPC requests scoped to a Free or Project Conversation runtime
// output: Lifecycle-safe Project overlays plus global Source mutation and auth operations
// pos: Server trust boundary mapping runtime ownership and locator stability to the Source store

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CONFIG_DIR, loadStoredConfig, saveConfig } from '@craft-agent/shared/config'
import {
  isFreeConversationWorkspaceId,
  isLocalMcpEnabled,
  resolveRuntimeWorkspace,
} from '@craft-agent/shared/workspaces'
import {
  getSourceCredentialManager,
  getSourceGrantRef,
  isSourceHostGranted,
  isProjectStdioExecutionAllowed,
  loadWorkspaceSources,
} from '@craft-agent/shared/sources'
import { safeJsonParse } from '@craft-agent/shared/utils/files'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sources.GET,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.START_OAUTH,
  RPC_CHANNELS.sources.SAVE_CREDENTIALS,
  RPC_CHANNELS.sources.GET_PERMISSIONS,
  RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.sources.GET_MCP_TOOLS,
] as const

export function registerSourcesHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger
  type SourceScope = {
    workspace: NonNullable<ReturnType<typeof resolveRuntimeWorkspace>>
    projectRoot: string | undefined
    mutationRoot: string
  }
  const resolveSourceScope = (workspaceId: string): SourceScope | null => {
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) return null
    const projectRoot = workspace && !isFreeConversationWorkspaceId(workspace.id)
      ? workspace.rootPath
      : undefined
    return {
      workspace,
      projectRoot,
      mutationRoot: projectRoot ?? CONFIG_DIR,
    }
  }
  const withSourceScope = async <T>(
    workspaceId: string,
    work: (scope: SourceScope) => Promise<T>,
  ): Promise<T> => {
    if (!isFreeConversationWorkspaceId(workspaceId)) {
      return deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => work({
        workspace,
        projectRoot: workspace.rootPath,
        mutationRoot: workspace.rootPath,
      }))
    }
    const scope = resolveSourceScope(workspaceId)
    if (!scope) throw new Error(`Workspace not found: ${workspaceId}`)
    return work(scope)
  }
  const withSourceOperationScope = <T>(
    workspaceId: string,
    work: (scope: SourceScope) => Promise<T>,
  ): Promise<T> => deps.sessionManager.withProjectOperation(workspaceId, async workspace => {
    const projectRoot = isFreeConversationWorkspaceId(workspace.id)
      ? undefined
      : workspace.rootPath
    return work({
      workspace,
      projectRoot,
      mutationRoot: projectRoot ?? CONFIG_DIR,
    })
  })

  // Get all sources for a workspace
  server.handle(RPC_CHANNELS.sources.GET, async (_ctx, workspaceId: string) => {
    try {
      return await withSourceScope(workspaceId, async ({ workspace, projectRoot }) => (
        loadWorkspaceSources(projectRoot, workspace.id)
      ))
    } catch (error) {
      if (error instanceof Error && /(?:Workspace|Project) not found:/.test(error.message)) {
        log.error(`SOURCES_GET: Workspace not found: ${workspaceId}`)
        return []
      }
      throw error
    }
  })

  // Create a new source
  server.handle(RPC_CHANNELS.sources.CREATE, async (_ctx, workspaceId: string, config: Partial<import('@craft-agent/shared/sources').CreateSourceInput>) => {
    return withSourceScope(workspaceId, async ({ mutationRoot }) => {
      const { createSource } = await import('@craft-agent/shared/sources')
      return createSource(mutationRoot, {
        name: config.name || 'New Source',
        provider: config.provider || 'custom',
        type: config.type || 'mcp',
        enabled: config.enabled ?? true,
        mcp: config.mcp,
        api: config.api,
        local: config.local,
      })
    })
  })

  // Delete a source
  server.handle(RPC_CHANNELS.sources.DELETE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const changedProjectIds = await withSourceScope(workspaceId, async ({ workspace, projectRoot }) => {
      const { deleteSource } = await import('@craft-agent/shared/sources')
      const source = loadWorkspaceSources(projectRoot, workspace.id)
        .find(candidate => candidate.config.slug === sourceSlug)
      if (!source) throw new Error(`Source not found: ${sourceSlug}`)

      deleteSource(source.workspaceRootPath, sourceSlug)
      try {
        await getSourceCredentialManager().deleteAll(source)
      } catch (error) {
        log.error(`Failed to clean credentials for deleted Source ${sourceSlug}:`, error)
      }

      // Remove the exact Host grant. Recreating the same slug is a new capability.
      const hostConfig = loadStoredConfig()
      const deletedRef = getSourceGrantRef(source)
      const deletedGrantPrefix = `${source.origin}:${sourceSlug}:`
      const legacyDeletedRef = `${source.origin}:${sourceSlug}`
      let changed = false
      const changedProjectIds: string[] = []
      for (const candidate of hostConfig?.workspaces ?? []) {
        if (source.origin === 'workspace' && candidate.id !== workspace.id) continue
        const next = candidate.defaultEnabledSourceRefs?.filter(ref =>
          ref !== deletedRef
          && ref !== legacyDeletedRef
          && !ref.startsWith(deletedGrantPrefix)
        )
        if (next?.length !== candidate.defaultEnabledSourceRefs?.length) {
          candidate.defaultEnabledSourceRefs = next
          changed = true
          changedProjectIds.push(candidate.id)
        }
      }
      if (changed && hostConfig) saveConfig(hostConfig)
      return changedProjectIds
    })

    await Promise.all(changedProjectIds.map(projectId =>
      deps.sessionManager.reconcileProjectSourceGrants(projectId)))
  })

  // Start OAuth flow for a source (DEPRECATED — use oauth:start + performOAuth client-side)
  // Kept for backward compatibility with old IPC preload; WS clients use performOAuth().
  server.handle(RPC_CHANNELS.sources.START_OAUTH, async () => {
    return {
      success: false,
      error: 'Deprecated: use the client-side performOAuth() flow (oauth:start + oauth:complete) instead',
    }
  })

  // Save credentials for a source (bearer token or API key)
  server.handle(RPC_CHANNELS.sources.SAVE_CREDENTIALS, async (_ctx, workspaceId: string, sourceSlug: string, credential: string) => {
    await withSourceScope(workspaceId, async ({ workspace, projectRoot }) => {
      const { loadSource, getSourceCredentialManager } = await import('@craft-agent/shared/sources')
      const source = loadSource(projectRoot, sourceSlug, workspace.id)
      if (!source) {
        throw new Error(`Source not found: ${sourceSlug}`)
      }

      // SourceCredentialManager handles credential type resolution
      await getSourceCredentialManager().save(source, { value: credential })
    })
    log.info(`Saved credentials for source: ${sourceSlug}`)
  })

  // Get permissions config for a source (raw format for UI display)
  server.handle(RPC_CHANNELS.sources.GET_PERMISSIONS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    if (!resolveRuntimeWorkspace(workspaceId)) return null
    return withSourceScope(workspaceId, async ({ mutationRoot }) => {
      const { loadRawSourcePermissions } = await import('@craft-agent/shared/agent')
      return loadRawSourcePermissions(mutationRoot, sourceSlug)
    })
  })

  // Get permissions config for a workspace (raw format for UI display)
  server.handle(RPC_CHANNELS.workspace.GET_PERMISSIONS, async (_ctx, workspaceId: string) => {
    if (isFreeConversationWorkspaceId(workspaceId) || !resolveRuntimeWorkspace(workspaceId)) return null
    return withSourceScope(workspaceId, async ({ projectRoot }) => {
      if (!projectRoot) return null
      const { loadRawWorkspacePermissions } = await import('@craft-agent/shared/agent')
      return loadRawWorkspacePermissions(projectRoot)
    })
  })

  // Get default permissions from ~/.craft-agent/permissions/default.json
  server.handle(RPC_CHANNELS.permissions.GET_DEFAULTS, async () => {
    const { existsSync, readFileSync } = await import('fs')
    const { getAppPermissionsDir } = await import('@craft-agent/shared/agent')
    const { join } = await import('path')

    const defaultPath = join(getAppPermissionsDir(), 'default.json')
    if (!existsSync(defaultPath)) return { config: null, path: defaultPath }

    try {
      const content = readFileSync(defaultPath, 'utf-8')
      return { config: safeJsonParse(content), path: defaultPath }
    } catch (error) {
      log.error('Error reading default permissions config:', error)
      return { config: null, path: defaultPath }
    }
  })

  // Get MCP tools for a source with permission status
  server.handle(RPC_CHANNELS.sources.GET_MCP_TOOLS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    try {
      return await withSourceOperationScope(workspaceId, async ({ workspace, projectRoot, mutationRoot }) => {
        const source = loadWorkspaceSources(projectRoot, workspace.id)
          .find(candidate => candidate.config.slug === sourceSlug)
        if (!source) return { success: false, error: 'Source not found' }
        if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }
        const mcp = source.config.mcp
        if (!mcp) return { success: false, error: 'MCP config not found' }
        if (
          !isFreeConversationWorkspaceId(workspace.id)
          && !isSourceHostGranted(workspace.defaultEnabledSourceRefs, source)
        ) {
          return { success: false, error: 'Source is not enabled by Host settings' }
        }
        if (!isProjectStdioExecutionAllowed(
          source,
          isLocalMcpEnabled(workspace.rootPath, workspace.localMcpEnabled),
        )) {
          return { success: false, error: 'Project-local MCP execution is disabled by Host settings' }
        }

        if (source.config.connectionStatus === 'needs_auth') {
          return { success: false, error: 'Source requires authentication' }
        }
        if (source.config.connectionStatus === 'failed') {
          return { success: false, error: source.config.connectionError || 'Connection failed' }
        }
        if (source.config.connectionStatus === 'untested') {
          return { success: false, error: 'Source has not been tested yet' }
        }

        let accessToken: string | undefined
        if (
          mcp.transport !== 'stdio'
          && (mcp.authType === 'oauth' || mcp.authType === 'bearer')
        ) {
          const credential = await getSourceCredentialManager().load(source)
          accessToken = credential?.value
        }

        const { permissionsConfigCache } = await import('@craft-agent/shared/agent')
        const mergedConfig = permissionsConfigCache.getMergedConfig({
          workspaceRootPath: mutationRoot,
          activeSourceSlugs: [sourceSlug],
        })

        const { CraftMcpClient } = await import('../../mcp')
        let client: InstanceType<typeof CraftMcpClient>
        if (mcp.transport === 'stdio') {
          if (!mcp.command) {
            return { success: false, error: 'Stdio MCP source is missing required "command" field' }
          }
          log.info(`Fetching MCP tools via stdio: ${mcp.command}`)
          client = new CraftMcpClient({
            transport: 'stdio',
            command: mcp.command,
            args: mcp.args,
            env: mcp.env,
          })
        } else {
          if (!mcp.url) {
            return { success: false, error: 'MCP source URL is required for HTTP/SSE transport' }
          }
          log.info(`Fetching MCP tools from ${mcp.url}`)
          client = new CraftMcpClient({
            transport: 'http',
            url: mcp.url,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          })
        }

        try {
          const tools = await client.listTools()
          return {
            success: true,
            tools: tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              allowed: mergedConfig.readOnlyMcpPatterns.some((pattern: RegExp) => pattern.test(tool.name)),
            })),
          }
        } finally {
          await client.close()
        }
      })
    } catch (error) {
      log.error('Failed to get MCP tools:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch tools'
      if (errorMessage.includes('404')) {
        return { success: false, error: 'MCP server endpoint not found. The server may be offline or the URL may be incorrect.' }
      }
      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        return { success: false, error: 'Authentication failed. Please re-authenticate with this source.' }
      }
      return { success: false, error: errorMessage }
    }
  })
}
