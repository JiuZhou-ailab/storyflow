// input: Workspace/config RPC requests plus host window and SessionManager services
// output: Shell-safe workspace navigation, registration, relinking, media, theme, and view handlers
// pos: Keeps workspace/file access available before the deferred Agent runtime is ready

import { join, resolve } from 'path'
import { homedir } from 'os'
import type { RemoteServerConnectionInput } from '@craft-agent/core/types'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, setActiveWorkspace, getWorkspaces } from '@craft-agent/shared/config'
import {
  ensureProjectOwnedDirectory,
  isPathWithinProjectRoot,
  isWorkspaceRootAvailable,
  resolveProjectOwnedPath,
  resolveRuntimeWorkspace,
} from '@craft-agent/shared/workspaces'
import { perf } from '@craft-agent/shared/utils'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { isValidWorkingDirectory, isValidWorkspaceRootPath } from '../../utils/path-validation'
import {
  normalizeRemoteServerConnectionInput,
  normalizeCreateWorkspaceOptions,
  type CreateWorkspaceOptions,
} from './workspace-creation'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.workspaces.GET,
  RPC_CHANNELS.workspaces.CREATE,
  RPC_CHANNELS.workspaces.RELINK,
  RPC_CHANNELS.workspaces.CHECK_SLUG,
  RPC_CHANNELS.workspaces.UPDATE_REMOTE,
  RPC_CHANNELS.window.GET_WORKSPACE,
  RPC_CHANNELS.window.GET_MODE,
  RPC_CHANNELS.window.RESOLVE_RUNTIME_WORKSPACE,
  RPC_CHANNELS.window.SWITCH_WORKSPACE,
  RPC_CHANNELS.workspace.READ_IMAGE,
  RPC_CHANNELS.workspace.WRITE_IMAGE,
  RPC_CHANNELS.theme.GET_APP,
  RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.LOAD_PRESET,
  RPC_CHANNELS.theme.GET_COLOR_THEME,
  RPC_CHANNELS.theme.SET_COLOR_THEME,
  RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
  RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES,
  RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME,
  RPC_CHANNELS.views.LIST,
  RPC_CHANNELS.views.SAVE,
  RPC_CHANNELS.toolIcons.GET_MAPPINGS,
  RPC_CHANNELS.logo.GET_URL,
] as const

export function registerWorkspaceCoreHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps
  const windowManager = deps.windowManager

  // Get workspaces (LOCAL_ONLY — includes rootPath for local Electron renderer)
  server.handle(RPC_CHANNELS.workspaces.GET, async () => {
    return sessionManager.getWorkspaces().map(workspace => ({
      ...workspace,
      rootAvailable: isWorkspaceRootAvailable(workspace),
    }))
  })

  // Create a new workspace at a folder path (Obsidian-style: folder IS the workspace)
  server.handle(RPC_CHANNELS.workspaces.CREATE, async (
    _ctx,
    folderPath: string,
    name: string,
    input?: CreateWorkspaceOptions | RemoteServerConnectionInput | Record<string, unknown>,
    legacyProjectType?: unknown,
  ) => {
    const rootPath = folderPath.trim()
    const validation = isValidWorkspaceRootPath(rootPath)
    if (!validation.valid) {
      throw new Error(validation.reason!)
    }

    const options = normalizeCreateWorkspaceOptions(input, legacyProjectType)
    await sessionManager.waitForInit()
    const workspace = await sessionManager.registerProject(name, rootPath, options.remoteServer)
    deps.platform.logger.info(`Created workspace "${name}" at ${rootPath}${options.remoteServer ? ` (remote: ${options.remoteServer.url})` : ''}`)
    return { ...workspace, rootAvailable: isWorkspaceRootAvailable(workspace) }
  })

  // Explicitly move one stable Host Project identity to its new local locator.
  server.handle(RPC_CHANNELS.workspaces.RELINK, async (_ctx, projectId: string, folderPath: string) => {
    const rootPath = folderPath.trim()
    const validation = isValidWorkingDirectory(rootPath)
    if (!validation.valid) throw new Error(validation.reason!)

    await sessionManager.waitForInit(projectId)
    const project = sessionManager.getWorkspaces().find(workspace => workspace.id === projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)
    if (sessionManager.getActiveSessionCount(projectId) > 0) {
      throw new Error('Stop all running sessions before relinking this Project.')
    }

    const updated = await sessionManager.rebindWorkspaceRoot(projectId, rootPath)
    setActiveWorkspace(projectId)
    deps.platform.logger.info(`Relinked Project ${projectId} to ${updated.rootPath}`)
    return updated
  })

  // Check if a workspace slug already exists (for validation before creation)
  server.handle(RPC_CHANNELS.workspaces.CHECK_SLUG, async (_ctx, slug: string) => {
    const defaultWorkspacesDir = join(homedir(), '.craft-agent', 'workspaces')
    const workspacePath = join(defaultWorkspacesDir, slug)
    const normalizedWorkspacePath = resolve(workspacePath)
    const exists = getWorkspaces().some((workspace) => resolve(workspace.rootPath) === normalizedWorkspacePath)
    return { exists, path: workspacePath }
  })

  // Update remote server config for an existing workspace (reconnect flow)
  server.handle(RPC_CHANNELS.workspaces.UPDATE_REMOTE, async (_ctx, workspaceId: string, remoteServer: RemoteServerConnectionInput) => {
    const normalized = normalizeRemoteServerConnectionInput(remoteServer)
    await sessionManager.updateRemoteProject(workspaceId, normalized)
    deps.platform.logger.info(`Updated remote server for workspace ${workspaceId}: ${normalized.url}`)
    return { success: true }
  })

  // Get workspace ID for the calling window
  server.handle(RPC_CHANNELS.window.GET_WORKSPACE, (ctx) => {
    return ctx.workspaceId ?? windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
  })

  // Get mode for the calling window (always 'main' now)
  server.handle(RPC_CHANNELS.window.GET_MODE, () => {
    return 'main'
  })

  // Resolve hidden and configured runtime workspaces through one ID contract.
  server.handle(
    RPC_CHANNELS.window.RESOLVE_RUNTIME_WORKSPACE,
    async (_ctx, workspaceId: string) => resolveRuntimeWorkspace(workspaceId),
  )

  // Switch workspace in current window (in-window switching)
  server.handle(RPC_CHANNELS.window.SWITCH_WORKSPACE, async (ctx, workspaceId: string) => {
    const end = perf.start('ipc.switchWorkspace', { workspaceId })
    let workspace
    try {
      workspace = await sessionManager.activateProject(workspaceId)
    } catch (error) {
      end()
      throw error
    }

    // Keep WS push routing in sync (works for both GUI and headless)
    server.updateClientWorkspace?.(ctx.clientId, workspaceId)

    if (windowManager) {
      const wcId = ctx.webContentsId!

      // Get the old workspace ID before updating
      const oldWorkspaceId = windowManager.getWorkspaceForWindow(wcId)

      // Update the window's workspace mapping
      const updated = windowManager.updateWindowWorkspace(wcId, workspaceId)

      // If update failed, the window may have been re-created (e.g., after refresh)
      // Try to register it
      if (!updated) {
        const win = windowManager.getWindowByWebContentsId(wcId)
        if (win) {
          windowManager.registerWindow(win, workspaceId)
          deps.platform.logger.info(`Re-registered window ${wcId} for workspace ${workspaceId}`)
        }
      }

      // Clear activeViewingSession for old workspace if no other windows are viewing it
      // This ensures read/unread state is correct after workspace switch
      if (oldWorkspaceId && oldWorkspaceId !== workspaceId) {
        const otherWindows = windowManager.getAllWindowsForWorkspace(oldWorkspaceId)
        if (otherWindows.length === 0) {
          sessionManager.clearActiveViewingSession(oldWorkspaceId)
        }
      }
    }

    end()

    // Return connection details so the preload RoutedClient can decide
    // whether to connect directly to a remote server for this workspace.
    return {
      workspaceId,
      remoteServer: workspace?.remoteServer ?? null,
    }
  })

  // ============================================================
  // Workspace Image Read/Write
  // ============================================================

  // Generic workspace image loading (for source icons, status icons, etc.)
  server.handle(RPC_CHANNELS.workspace.READ_IMAGE, async (_ctx, workspaceId: string, relativePath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { lstatSync, readFileSync } = await import('fs')

    // Security: validate path
    // - Must not contain .. (path traversal)
    // - Must be a valid image extension
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    return sessionManager.withProjectLifecycle(workspace.id, async (currentWorkspace) => {
      const absolutePath = resolve(currentWorkspace.rootPath, relativePath)
      if (!isPathWithinProjectRoot(currentWorkspace.rootPath, absolutePath, { allowMissing: true })) {
        throw new Error(`Project image path contains a symbolic link or escapes the Project: ${relativePath}`)
      }
      try {
        lstatSync(absolutePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null  // Missing optional files - silent fallback to default icons
        }
        throw error
      }
      resolveProjectOwnedPath(currentWorkspace.rootPath, absolutePath)

      const buffer = readFileSync(absolutePath)
      if (ext === '.svg') return buffer.toString('utf-8')

      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.gif': 'image/gif',
      }
      const mimeType = mimeTypes[ext] || 'image/png'
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    })
  })

  // Generic workspace image writing (for workspace icon, etc.)
  // Resizes images to max 256x256 to keep file sizes small
  server.handle(RPC_CHANNELS.workspace.WRITE_IMAGE, async (_ctx, workspaceId: string, relativePath: string, base64: string, mimeType: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { lstatSync, writeFileSync, unlinkSync, readdirSync } = await import('fs')
    const { basename, dirname } = await import('path')

    // Security: validate path
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(base64, 'base64')
    let output: Buffer<ArrayBufferLike> = buffer

    if (mimeType !== 'image/svg+xml' && ext !== '.svg') {
      const metadata = await deps.platform.imageProcessor.getMetadata(buffer)
      const width = metadata?.width ?? 0
      const height = metadata?.height ?? 0

      if (width > 256 || height > 256) {
        output = await deps.platform.imageProcessor.process(buffer, {
          resize: { width: 256, height: 256 },
          format: 'png',
        })
      }
    }

    await sessionManager.withProjectLifecycle(workspace.id, async (currentWorkspace) => {
      const absolutePath = resolve(currentWorkspace.rootPath, relativePath)
      ensureProjectOwnedDirectory(currentWorkspace.rootPath, dirname(absolutePath))
      try {
        lstatSync(absolutePath)
        resolveProjectOwnedPath(currentWorkspace.rootPath, absolutePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }

      // If this is an icon file (icon.*), delete any existing icon files with different extensions
      const fileName = basename(relativePath)
      if (fileName.startsWith('icon.')) {
        const files = readdirSync(currentWorkspace.rootPath)
        for (const file of files) {
          if (file.startsWith('icon.') && file !== fileName) {
            const oldPath = join(currentWorkspace.rootPath, file)
            try {
              unlinkSync(oldPath)
            } catch {
              // Ignore errors deleting old icon
            }
          }
        }
      }

      writeFileSync(absolutePath, output)
    })
  })

  // ============================================================
  // Theme (app-level only)
  // ============================================================

  server.handle(RPC_CHANNELS.theme.GET_APP, async () => {
    const { loadAppTheme } = await import('@craft-agent/shared/config/storage')
    return loadAppTheme()
  })

  // Preset themes (app-level)
  server.handle(RPC_CHANNELS.theme.GET_PRESETS, async () => {
    const { loadPresetThemes } = await import('@craft-agent/shared/config/storage')
    return loadPresetThemes()
  })

  server.handle(RPC_CHANNELS.theme.LOAD_PRESET, async (_ctx, themeId: string) => {
    const { loadPresetTheme } = await import('@craft-agent/shared/config/storage')
    return loadPresetTheme(themeId)
  })

  server.handle(RPC_CHANNELS.theme.GET_COLOR_THEME, async () => {
    const { getColorTheme } = await import('@craft-agent/shared/config/storage')
    return getColorTheme()
  })

  server.handle(RPC_CHANNELS.theme.SET_COLOR_THEME, async (_ctx, themeId: string) => {
    const { setColorTheme } = await import('@craft-agent/shared/config/storage')
    setColorTheme(themeId)
  })

  // Broadcast theme preferences to all other windows (for cross-window sync)
  server.handle(RPC_CHANNELS.theme.BROADCAST_PREFERENCES, async (ctx, preferences: { mode: string; colorTheme: string; font: string }) => {
    pushTyped(server, RPC_CHANNELS.theme.PREFERENCES_CHANGED, { to: 'all' }, preferences)
  })

  // Workspace-level theme overrides
  server.handle(RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, async (_ctx, workspaceId: string) => {
    const { getWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    if (!getWorkspaceByNameOrId(workspaceId)) return null
    return sessionManager.withProjectLifecycle(
      workspaceId,
      async workspace => getWorkspaceColorTheme(workspace.rootPath) ?? null,
    )
  })

  server.handle(RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, async (_ctx, workspaceId: string, themeId: string | null) => {
    const { setWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    if (!getWorkspaceByNameOrId(workspaceId)) return
    await sessionManager.withProjectLifecycle(workspaceId, async workspace => {
      setWorkspaceColorTheme(workspace.rootPath, themeId ?? undefined)
    })
  })

  server.handle(RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES, async () => {
    const { getWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    const workspaces = sessionManager.getWorkspaces()
    const themes: Record<string, string | undefined> = {}
    for (const ws of workspaces) {
      themes[ws.id] = await sessionManager.withProjectLifecycle(
        ws.id,
        async workspace => getWorkspaceColorTheme(workspace.rootPath),
      )
    }
    return themes
  })

  // Broadcast workspace theme change to all other windows (for cross-window sync)
  server.handle(RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME, async (ctx, workspaceId: string, themeId: string | null) => {
    pushTyped(server, RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED, { to: 'all' }, { workspaceId, themeId })
  })

  // ============================================================
  // Views
  // ============================================================

  // List views for a workspace (dynamic expression-based filters stored in views.json)
  server.handle(RPC_CHANNELS.views.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listViews } = await import('../../services/views-storage')
    return sessionManager.withProjectLifecycle(
      workspace.id,
      async currentWorkspace => listViews(currentWorkspace.rootPath),
    )
  })

  // Save views (replaces full array)
  server.handle(RPC_CHANNELS.views.SAVE, async (_ctx, workspaceId: string, views: import('@craft-agent/shared/views').ViewConfig[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { saveViews } = await import('../../services/views-storage')
    await sessionManager.withProjectLifecycle(
      workspace.id,
      async currentWorkspace => saveViews(currentWorkspace.rootPath, views),
    )
    // Broadcast labels changed since views are used alongside labels in sidebar
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  })

  // ============================================================
  // Tool Icons and Logo
  // ============================================================

  // Tool icon mappings — loads tool-icons.json and resolves each entry's icon to a data URL
  // for display in the Appearance settings page
  server.handle(RPC_CHANNELS.toolIcons.GET_MAPPINGS, async () => {
    const { getToolIconsDir } = await import('@craft-agent/shared/config/storage')
    const { loadToolIconConfig } = await import('@craft-agent/shared/utils/cli-icon-resolver')
    const { encodeIconToDataUrl } = await import('@craft-agent/shared/utils/icon-encoder')
    const { join } = await import('path')

    const toolIconsDir = getToolIconsDir()
    const config = loadToolIconConfig(toolIconsDir)
    if (!config) return []

    return config.tools
      .map(tool => {
        const iconPath = join(toolIconsDir, tool.icon)
        const iconDataUrl = encodeIconToDataUrl(iconPath)
        if (!iconDataUrl) return null
        return {
          id: tool.id,
          displayName: tool.displayName,
          iconDataUrl,
          commands: tool.commands,
        }
      })
      .filter(Boolean)
  })

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  server.handle(RPC_CHANNELS.logo.GET_URL, async (_ctx, serviceUrl: string, provider?: string) => {
    const { getLogoUrl } = await import('@craft-agent/shared/utils/logo')
    const result = getLogoUrl(serviceUrl, provider)
    return result
  })
}
