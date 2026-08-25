// input: Electron app lifecycle, user config, workspace state, and local server runtime
// output: Desktop main-process bootstrap, token-safe IPC bridges, windows, and cleanup
// pos: Coordinates the Electron shell around the shared Storyflow server core

import { startShellEnvLoad, whenShellEnvReady } from './shell-env'

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, net, shell } from 'electron'
import { randomUUID } from 'crypto'
import { homedir } from 'os'

// Initialize i18n for main process (menus, dialogs, etc.)
import { setupI18n, i18n } from '@craft-agent/shared/i18n'
setupI18n()

import { dirname, join, delimiter } from 'path'
import { existsSync, readFileSync } from 'fs'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@craft-agent/server-core/sessions'
import { registerAllRpcHandlers } from './handlers/index'
import { registerCoreRpcHandlers, cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import type { PlatformServices } from '@craft-agent/server-core/runtime'
import { CLIENT_AUTH_IPC_CHANNELS, SKILLS_MARKET_IPC_CHANNELS } from '../shared/types'
import type { SkillMarketPublishInput } from '@craft-agent/shared/skills/marketplace'
import { createElectronPlatform } from './platform'
import type { HandlerDeps } from './handlers/handler-deps'
import { bootstrapServer, releaseServerLock } from '@craft-agent/server-core/bootstrap'
import { createMessagingBootstrap, type MessagingBootstrapHandle } from '@craft-agent/messaging-gateway'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { initModelRefreshService, getModelRefreshService, resolveModelRefreshCredentials, setFetcherPlatform } from '@craft-agent/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@craft-agent/server-core/services'
import { createApplicationMenu } from './menu'
import { WindowManager } from './window-manager'
import { loadWindowState, saveWindowState } from './window-state'
import {
  getLlmConnection,
  getWorkspaces,
  getWorkspaceByNameOrId,
  isManagedLlmConnectionSlug,
  MANAGED_LLM_CONNECTION_SLUG,
  MANAGED_LLM_CONNECTION_SLUGS,
  migrateRemoteServerCredentialsOnStartup,
} from '@craft-agent/shared/config'
import { initializeDocs } from '@craft-agent/shared/docs'
import { initializeReleaseNotes } from '@craft-agent/shared/release-notes'
import { seedDefaultAgentResources } from '@craft-agent/shared/agent-defaults'
import { ensureDefaultPermissions } from '@craft-agent/shared/agent/permissions-config'
import { ensureToolIcons, ensurePresetThemes } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { setPowerShellValidatorRoot } from '@craft-agent/shared/agent'
import { handleDeepLink } from './deep-link'
import { BrowserPaneManager } from './browser-pane-manager'
import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { registerThumbnailScheme, registerThumbnailHandler } from './thumbnail-protocol'
import log, { isDebugMode, mainLog, getLogFilePath, getMessagingGatewayLogFilePath, messagingGatewayLog } from './logger'
import { configurePerfTracking, enableDebug, formatPerfMetric } from '@craft-agent/shared/utils'
import {
  isRestorableWindowWorkspace,
  resolvePersistedWindowsAfterClose,
  resolveActivateWindowWorkspaceId,
  resolveStartupWindowWorkspaceId,
  shouldSaveOpenWindowsOnQuit,
  shouldRestoreWorkspaceWindowsOnOrdinaryStartup,
} from './startup-window'
import { registerPiModelResolver } from '@craft-agent/shared/config'
import { getPiModelsForAuthProvider, getAllPiModels } from '@craft-agent/shared/config'
import { initNotificationService, initBadgeIcon, initInstanceBadge, updateBadgeCount } from './notifications'
import {
  checkForUpdatesOnLaunch,
  isUpdating,
  setAutoUpdateEventSink,
  setUpdateInstallPreparation,
} from './auto-update'
import { consumeLaunchUpdateCheckDecision } from './auto-update-launch-policy'
import { createQuitCoordinator } from './quit-coordinator'
import type { EventSink } from '@craft-agent/server-core/transport'
import { validateGitBashPath, checkVCRedistInstalled } from '@craft-agent/server-core/services'
import { shouldCreateWindowsAfterStartup } from './startup-state'
import {
  createClientAuthConfigFromRuntimeEnv,
  createClientAuthService,
  type ClientAuthService,
  type ClientAuthState,
} from './client-auth'
import { readClientAuthOverrides } from './client-auth-overrides'
import { createClientAuthSessionStore } from './client-auth-session-store'
import {
  DEFAULT_TOOL_GATEWAY_BASE_URL,
  MODEL_ACCESS_BROKER_TOKEN_ENV,
  MODEL_ACCESS_BROKER_URL_ENV,
  TOOL_BROKER_TOKEN_ENV,
  TOOL_BROKER_URL_ENV,
  startManagedCapabilityBroker,
  type ManagedCapabilityBroker,
} from './managed-capability-broker'
import { resolveElectronRuntimePaths } from './runtime-paths'
import { getAppVersion } from '@craft-agent/shared/version'
import { normalizeFeedbackIssueInput, submitFeedbackIssue } from './feedback'
import {
  downloadSkillFromMarket,
  getSkillDetailFromMarket,
  listSkillsFromMarket,
  publishSkillToMarket,
} from './skills-market-client'

// Initialize electron-log for renderer process support
log.initialize()

// Enable debug/perf in dev mode (running from source)
if (isDebugMode) {
  process.env.CRAFT_DEBUG = '1'
  enableDebug()
  configurePerfTracking({
    enabled: true,
    onMetric: metric => {
      mainLog.debug(formatPerfMetric(metric))
    },
  })
}

// Bundle CLI tools: resolve platform-specific uv binary and wrapper scripts.
// These are available to all agent Bash sessions via CRAFT_UV, CRAFT_SCRIPTS env vars
// and PATH prepend. uv auto-downloads Python 3.12 on first use (~5s, then cached).
{
  // In packaged app: runtime resources are single-rooted at app/dist/resources/.
  // In dev: resources are at __dirname/../resources/ (sibling of dist/)
  const runtimePaths = resolveElectronRuntimePaths({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    dirname: __dirname,
    cwd: process.cwd(),
    platform: process.platform,
    arch: process.arch,
  })

  const bundledUvExists = existsSync(runtimePaths.uvBinary)
  const fallbackUv = bundledUvExists ? null : 'uv'

  // Runtime resolver hints for shared session tools
  process.env.CRAFT_IS_PACKAGED = app.isPackaged ? '1' : '0'
  process.env.CRAFT_RESOURCES_BASE = runtimePaths.resourcesBase
  process.env.CRAFT_APP_ROOT = runtimePaths.appRoot

  process.env.CRAFT_UV = bundledUvExists ? runtimePaths.uvBinary : (fallbackUv ?? runtimePaths.uvBinary)

  // Bun runtime (packaged builds should prefer bundled runtime over PATH)
  if (existsSync(runtimePaths.bunBinary)) {
    process.env.CRAFT_BUN = runtimePaths.bunBinary
  }

  process.env.CRAFT_SCRIPTS = runtimePaths.scriptsDir
  process.env.CRAFT_COMMANDS_ENTRY = runtimePaths.commandsEntry
  process.env.CRAFT_CLI_ENTRY = runtimePaths.cliEntry
  process.env.CRAFT_COMMANDS_DOC_PATH = runtimePaths.commandsDocPath
  process.env.CRAFT_CLI_DOC_PATH = process.env.CRAFT_COMMANDS_DOC_PATH
  process.env.CRAFT_AGENT_VERSION = app.getVersion()
  // Prepend both generic wrappers dir and platform uv dir:
  // - binDir exposes wrapper commands (pdf-tool, docx-tool, ...)
  // - uvPlatformDir exposes raw `uv` for direct shell usage / debugging
  process.env.PATH = `${dirname(runtimePaths.bunBinary)}${delimiter}${runtimePaths.binDir}${delimiter}${runtimePaths.uvPlatformDir}${delimiter}${process.env.PATH}`

  if (!bundledUvExists) {
    mainLog.warn('Bundled uv binary missing, CLI document tools may fail unless uv is available on PATH.', {
      expectedUvPath: runtimePaths.uvBinary,
      usingCraftUv: process.env.CRAFT_UV,
    })
  }

  if (isDebugMode) {
    mainLog.info('CLI tools configured:', {
      uvBinary: process.env.CRAFT_UV,
      binDir: runtimePaths.binDir,
      scriptsDir: runtimePaths.scriptsDir,
      bundledUvExists,
    })
  }
}

// Register Pi model resolver so llm-connections.ts can resolve Pi models
// without importing @earendil-works/pi-ai (which breaks the Vite renderer build)
registerPiModelResolver((piAuthProvider) =>
  piAuthProvider ? getPiModelsForAuthProvider(piAuthProvider) : getAllPiModels()
)

// Custom URL scheme for deeplinks (e.g., craftagents://auth-complete)
// Supports multi-instance dev: CRAFT_DEEPLINK_SCHEME env var (craftagents1, craftagents2, etc.)
const DEEPLINK_SCHEME = process.env.CRAFT_DEEPLINK_SCHEME || 'craftagents'

let windowManager: WindowManager | null = null
let sessionManager: SessionManager | null = null
let clientAuthService: ClientAuthService | null = null
let managedCapabilityBroker: ManagedCapabilityBroker | null = null
let browserPaneManager: BrowserPaneManager | null = null
let oauthFlowStore: OAuthFlowStore | null = null
let moduleSink: EventSink | null = null
let moduleClientResolver: ((webContentsId: number) => string | undefined) | null = null
let mainStartupSucceeded = false
let mainStartupIsHeadless = !!process.env.CRAFT_HEADLESS

// Messaging gateway: the bootstrap handle is created once sessionManager is
// available (inside createHandlerDeps) and populated with the WS publisher
// after bootstrapServer resolves. Both hosts (Electron + standalone) wire
// through createMessagingBootstrap — do not construct MessagingGatewayRegistry
// directly.
let messagingHandle: MessagingBootstrapHandle | null = null

// Store pending deep link if app not ready yet (cold start)
let pendingDeepLink: string | null = null

// Set app name early (before app.whenReady) to ensure correct macOS menu bar title
// Supports multi-instance dev: CRAFT_APP_NAME env var (e.g., "Storyflow [1]")
app.setName(process.env.CRAFT_APP_NAME || 'Storyflow')

// Register as default protocol client for craftagents:// URLs
// This must be done before app.whenReady() on some platforms
if (process.defaultApp) {
  // Development mode: need to pass the app path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]])
  }
} else {
  // Production mode
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

// Apply network proxy settings early (Node-level only — Electron sessions require app.whenReady)
import { applyConfiguredProxySettings } from './network-proxy'
void applyConfiguredProxySettings()

// Register thumbnail:// custom protocol for file preview thumbnails in the sidebar.
// Must happen before app.whenReady() — Electron requires early scheme registration.
registerThumbnailScheme()

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  mainLog.info('Received deeplink:', url)

  if (windowManager) {
    handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined).catch(err => {
      mainLog.error('Failed to handle deep link:', err)
    })
  } else {
    // App not ready - store for later
    pendingDeepLink = url
  }
})

// Handle deeplink on Windows/Linux (single instance check)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // On Windows/Linux, the deeplink is in commandLine
    const url = commandLine.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`))
    if (url && windowManager) {
      mainLog.info('Received deeplink from second instance:', url)
      handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined).catch(err => {
        mainLog.error('Failed to handle deep link:', err)
      })
    } else if (windowManager) {
      // No deep link - just focus the first window
      const windows = windowManager.getAllWindows()
      if (windows.length > 0) {
        const win = windows[0].window
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
  })
}

// Helper to create initial windows on startup
async function createInitialWindows(): Promise<void> {
  if (!windowManager) return

  // Load saved window state
  const savedState = loadWindowState()
  const workspaces = getWorkspaces()

  if (savedState?.windows.length && shouldRestoreWorkspaceWindowsOnOrdinaryStartup({ savedWindowCount: savedState.windows.length })) {
    // Restore windows from saved state
    let restoredCount = 0

    for (const saved of savedState.windows) {
      // Skip invalid workspaces
      if (!isRestorableWindowWorkspace(
        saved.workspaceId,
        workspaces,
        workspaceId => Boolean(getCredentialManager().peekRemoteServerToken(workspaceId)),
      )) continue

      mainLog.info(`Restoring window: workspaceId=${saved.workspaceId}, url=${saved.url ?? 'none'}`)
      const win = windowManager.createWindow({
        workspaceId: saved.workspaceId,
        restoreUrl: saved.url,
      })
      win.setBounds(saved.bounds)

      restoredCount++
    }

    if (restoredCount > 0) {
      mainLog.info(`Restored ${restoredCount} window(s) from saved state`)
      return
    }
  }

  const startupWorkspaceId = resolveStartupWindowWorkspaceId(workspaces)
  windowManager.createWindow({ workspaceId: startupWorkspaceId })
  mainLog.info(startupWorkspaceId
    ? `Created window for first workspace: ${workspaces[0].name}`
    : 'Created project hub window without a workspace')
}

app.whenReady().then(async () => {
  // Export packaged state as env var so logger.ts (and headless Bun) don't need 'electron'
  process.env.CRAFT_IS_PACKAGED = app.isPackaged ? 'true' : 'false'

  // Register bundled assets root so all seeding functions can find their files
  // (docs, permissions, themes, tool-icons resolve via getBundledAssetsDir)
  setBundledAssetsRoot(__dirname)

  // Register PowerShell validator root so it can find the bundled parser script
  // (Windows only: validates PowerShell commands in Explore mode using AST analysis)
  setPowerShellValidatorRoot(join(__dirname, 'resources'))

  // Initialize bundled docs
  initializeDocs()

  // Initialize bundled release notes
  initializeReleaseNotes()

  // Seed product-wide Skills and Sources. Domain Skills remain explicit project installs.
  seedDefaultAgentResources()

  // Ensure default permissions file exists (copies bundled default.json on first run)
  ensureDefaultPermissions()

  // Seed tool icons to ~/.craft-agent/tool-icons/ (copies bundled SVGs on first run)
  ensureToolIcons()

  // Seed preset themes to ~/.craft-agent/themes/ (copies bundled theme JSONs on first run)
  ensurePresetThemes()

  // Register thumbnail:// protocol handler (scheme was registered earlier, before app.whenReady)
  registerThumbnailHandler()

  // Re-apply proxy settings now that Electron sessions are available
  // (first call before app.whenReady only configured Node-level proxy)
  await applyConfiguredProxySettings()

  // Note: electron-updater handles pending updates internally via autoInstallOnAppQuit

  // Application menu is created after windowManager initialization (see below)

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    // In packaged app, resources are at dist/resources/ (same level as __dirname)
    // In dev, resources are at ../resources/ (sibling of dist/)
    const dockIconPath = [
      join(__dirname, 'resources/icon.png'),
      join(__dirname, '../resources/icon.png'),
    ].find(p => existsSync(p))

    if (dockIconPath) {
      app.dock.setIcon(dockIconPath)
      // Initialize badge icon for canvas-based badge overlay
      initBadgeIcon(dockIconPath)
    }

    // Multi-instance dev: show instance number badge on dock icon
    // CRAFT_INSTANCE_NUMBER is set by detect-instance.sh for numbered folders
    const instanceNum = process.env.CRAFT_INSTANCE_NUMBER
    if (instanceNum) {
      const num = parseInt(instanceNum, 10)
      if (!isNaN(num) && num > 0) {
        initInstanceBadge(num)
      }
    }
  }

  try {
    if (!process.env.CRAFT_SERVER_URL) {
      await migrateRemoteServerCredentialsOnStartup()
    }

    // Initialize window manager
    windowManager = new WindowManager()
    windowManager.setBeforeWindowDestroyed((closingWindow, remainingWindows) => {
      const windows = resolvePersistedWindowsAfterClose(remainingWindows, closingWindow)
      saveWindowState({ windows, lastFocusedWorkspaceId: windows[0]?.workspaceId })
    })

    // Create the application menu (needs windowManager for New Window action)
    createApplicationMenu(windowManager)

    // When CRAFT_SERVER_URL is set, this Electron instance is a thin client —
    // it only creates windows whose preload connects to the remote server.
    // Skip server-side initialization (SessionManager, model refresh, platform injection).
    const isClientOnly = !!process.env.CRAFT_SERVER_URL
    const isHeadless = !!process.env.CRAFT_HEADLESS
    mainStartupIsHeadless = isHeadless

    if (isClientOnly) {
      mainLog.info(`Client-only mode: CRAFT_SERVER_URL=${process.env.CRAFT_SERVER_URL} (server initialization skipped)`)
    }

    // Initialize notification service (always — triggered by server push events)
    initNotificationService(windowManager)

    // Initialize browser pane manager (always — even in headless, for deps wiring)
    browserPaneManager = new BrowserPaneManager()
    browserPaneManager.setWindowManager(windowManager)
    browserPaneManager.registerToolbarIpc()

    // Build real PlatformServices from Electron APIs
    const platform: PlatformServices = createElectronPlatform({
      app,
      nativeImage,
      shell,
      nativeTheme,
      logger: log,
      isDebugMode,
      getLogFilePath,
    })

    // Bootstrap IPC handlers — preload uses sendSync for window-local details
    ipcMain.on('__get-web-contents-id', (e) => {
      e.returnValue = e.sender.id
    })
    ipcMain.on('__get-workspace-id', (e) => {
      e.returnValue = windowManager?.getWorkspaceForWindow(e.sender.id) ?? ''
    })

    // Transport diagnostics bridge — preload reports remote WS connection state changes
    // so failures are visible in terminal/main.log (not only renderer console).
    ipcMain.on('__transport:status', (_event, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as {
        level?: 'info' | 'warn' | 'error'
        message?: string
        status?: string
        attempt?: number
        nextRetryInMs?: number
        error?: unknown
        close?: unknown
        url?: string
      }

      const level = p.level ?? 'info'
      const message = p.message ?? '[transport] status update'
      const context = {
        status: p.status,
        attempt: p.attempt,
        nextRetryInMs: p.nextRetryInMs,
        error: p.error,
        close: p.close,
        url: p.url,
      }

      if (level === 'error') {
        mainLog.error(message, context)
      } else if (level === 'warn') {
        mainLog.warn(message, context)
      } else {
        mainLog.info(message, context)
      }
    })

    // Dialog bridge — preload capability handlers use ipcRenderer.invoke to
    // call main-process-only dialog APIs (dialog, BrowserWindow).
    ipcMain.handle('__dialog:showMessageBox', async (event, spec) => {
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showMessageBox(win, spec)
      return { response: result.response }
    })
    ipcMain.handle('__dialog:showOpenDialog', async (event, spec) => {
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, spec)
      return { canceled: result.canceled, filePaths: result.filePaths }
    })

    const clientAuthOverrides = readClientAuthOverrides(app.getPath('userData'))
    const clientAuthOverrideKeys = Object.keys(clientAuthOverrides.values)
    if (clientAuthOverrideKeys.length > 0) {
      mainLog.info(`[client-auth] Applying overrides from ${clientAuthOverrides.filePath}: ${clientAuthOverrideKeys.join(', ')}`)
    }
    const clientAuthSessionStore = createClientAuthSessionStore()
    const initialClientAuthSession = await clientAuthSessionStore.load()
    const broadcastClientAuthState = (nextState: ClientAuthState) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(CLIENT_AUTH_IPC_CHANNELS.STATE_CHANGED, nextState)
        }
      }
    }
    const clientAuthConfig = createClientAuthConfigFromRuntimeEnv({
      ...process.env,
      ...clientAuthOverrides.values,
    })
    const managedModelAccessConfigured = Boolean(
      clientAuthConfig.authBrokerUrl ?? clientAuthConfig.feishuBrokerAuth?.brokerUrl,
    )
    const revokeManagedModelRuntimes = async (): Promise<void> => {
      if (!sessionManager) return
      await Promise.all(
        MANAGED_LLM_CONNECTION_SLUGS.map(slug =>
          sessionManager!.disposeConnectionRuntimes(slug)
        ),
      )
    }
    const authService = createClientAuthService(clientAuthConfig, {
      initialSession: initialClientAuthSession,
      sessionStore: clientAuthSessionStore,
      openExternal: (url) => shell.openExternal(url).then(() => undefined),
      onAuthChange: (change) => {
        broadcastClientAuthState(change.state)
        if (!change.session) {
          void revokeManagedModelRuntimes().catch(error => {
            mainLog.warn('[client-auth] Failed to revoke managed model runtimes:', error)
          })
        }
      },
    })
    clientAuthService = authService
    const initialClientAuthState = authService.getState()
    if (initialClientAuthState.required) {
      mainLog.info(`[client-auth] Required (${initialClientAuthState.configured ? 'configured' : 'not configured'})`)
    }

    ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.GET_STATE, () => authService.getState())
    ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.SIGN_IN, async (_event, input: unknown) => {
      const record = input && typeof input === 'object'
        ? input as Record<string, unknown>
        : {}
      return authService.signIn({
        identifier: typeof record.identifier === 'string' ? record.identifier : '',
        password: typeof record.password === 'string' ? record.password : '',
      })
    })
    ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.SIGN_UP, async (_event, input: unknown) => {
      const record = input && typeof input === 'object'
        ? input as Record<string, unknown>
        : {}
      return authService.signUp({
        identifier: typeof record.identifier === 'string' ? record.identifier : '',
        password: typeof record.password === 'string' ? record.password : '',
        name: typeof record.name === 'string' ? record.name : undefined,
      })
    })
    ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.VERIFY_EMAIL, async (_event, input: unknown) => {
      const record = input && typeof input === 'object'
        ? input as Record<string, unknown>
        : {}
      await authService.verifyEmailOtp({
        email: typeof record.email === 'string' ? record.email : '',
        otp: typeof record.otp === 'string' ? record.otp : '',
      })
    })
    ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.RESEND_VERIFICATION_EMAIL, async (_event, input: unknown) => {
      const record = input && typeof input === 'object'
        ? input as Record<string, unknown>
        : {}
      await authService.sendEmailVerificationOtp({
        email: typeof record.email === 'string' ? record.email : '',
      })
    })
    ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.SIGN_IN_WITH_FEISHU, () => authService.signInWithFeishu())
    ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.CANCEL_FEISHU_SIGN_IN, () => {
      authService.cancelFeishuSignIn()
    })
    ipcMain.handle(CLIENT_AUTH_IPC_CHANNELS.SIGN_OUT, () => authService.signOut())
    const getSkillsMarketToken = async (): Promise<string | undefined> => {
      return authService.getState().authenticated
        ? authService.issueSkillsMarketAccessToken()
        : undefined
    }
    ipcMain.handle(SKILLS_MARKET_IPC_CHANNELS.LIST, async () => {
      return listSkillsFromMarket({
        token: await getSkillsMarketToken(),
        fetchImpl: (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init),
      })
    })
    ipcMain.handle(SKILLS_MARKET_IPC_CHANNELS.DETAIL, async (_event, skillSlug: string) => {
      return getSkillDetailFromMarket(skillSlug, {
        token: await getSkillsMarketToken(),
        fetchImpl: (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init),
      })
    })
    ipcMain.handle(SKILLS_MARKET_IPC_CHANNELS.DOWNLOAD, async (_event, input) => {
      return downloadSkillFromMarket(input, {
        token: await getSkillsMarketToken(),
        fetchImpl: (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init),
      })
    })
    ipcMain.handle(SKILLS_MARKET_IPC_CHANNELS.PUBLISH, async (_event, input: SkillMarketPublishInput) => {
      const user = authService.getState().user
      if (!user) throw new Error('Sign in before publishing a Skill')
      const token = await authService.issueSkillsMarketAccessToken()
      return publishSkillToMarket(input, {
        author: { name: user.name ?? user.email ?? user.userId },
        token,
        fetchImpl: (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init),
      })
    })
    ipcMain.handle('feedback:submitIssue', async (_event, input: unknown) => {
      return submitFeedbackIssue(normalizeFeedbackIssueInput(input), {
        fetch: (url, init) => net.fetch(url, init),
      })
    })

    let scheduleDeferredRuntime: (() => void) | null = null

    if (!isClientOnly) {
      // Restore persisted Git Bash path on Windows (must happen before any SDK subprocess spawn)
      if (process.platform === 'win32') {
        const { getGitBashPath, clearGitBashPath } = await import('@craft-agent/shared/config')
        const gitBashPath = getGitBashPath()
        if (gitBashPath) {
          const validation = await validateGitBashPath(gitBashPath)
          if (validation.valid) {
            process.env.CLAUDE_CODE_GIT_BASH_PATH = validation.path
          } else {
            clearGitBashPath()
            delete process.env.CLAUDE_CODE_GIT_BASH_PATH
            mainLog.warn(`Cleared invalid persisted Git Bash path: ${gitBashPath}`)
          }
        }
      }

      // Check for VC++ Redistributable on Windows (required by onnxruntime / markitdown).
      // Without it, document conversion tools (PDF, PPTX, DOCX, XLSX) crash with DLL errors.
      // Sets env var so renderer can show an actionable toast with install button.
      if (process.platform === 'win32') {
        const vcCheck = checkVCRedistInstalled()
        if (!vcCheck.installed) {
          mainLog.warn('[vcredist]', vcCheck.message)
          process.env.CRAFT_VCREDIST_MISSING = '1'
          if (vcCheck.downloadUrl) {
            process.env.CRAFT_VCREDIST_URL = vcCheck.downloadUrl
          }
        } else if (isDebugMode) {
          mainLog.info('[vcredist]', vcCheck.message)
        }
      }

      // Pre-import power manager (async import needed for applyPlatformToSubsystems)
      const { onSessionStarted, onSessionStopped } = await import('./power-manager')

      // Client ID tracking for Electron IPC bridge (webContentsId → clientId)
      const clientMap = new Map<number, string>()
      const resolveClientId = (wcId: number) => clientMap.get(wcId)

      // Read embedded server config (Server settings page)
      const { getServerConfig } = await import('@craft-agent/shared/config')
      const embeddedServerConfig = getServerConfig()
      const serverModeEnabled = embeddedServerConfig.enabled && !isClientOnly
      const managedConnection = getLlmConnection(MANAGED_LLM_CONNECTION_SLUG)

      if (!serverModeEnabled && !isClientOnly && managedModelAccessConfigured && managedConnection?.baseUrl) {
        try {
          managedCapabilityBroker = await startManagedCapabilityBroker({
            modelGatewayBaseUrl: managedConnection.baseUrl,
            toolGatewayBaseUrl: process.env.STORYFLOW_TOOL_GATEWAY_URL ?? DEFAULT_TOOL_GATEWAY_BASE_URL,
            isAuthenticated: () => authService.getState().authenticated,
            ensureModelAccessToken: (options) => authService.ensureModelAccessToken(options),
            ensureToolAccessToken: (options) => authService.ensureToolAccessToken(options),
          })
          Object.assign(process.env, managedCapabilityBroker.env)
        } catch (error) {
          mainLog.warn('[managed-capability] Failed to start local capability broker:', error)
        }
      }

      // Derive host/port/token from server config (or env overrides)
      const serverToken = serverModeEnabled && embeddedServerConfig.token
        ? embeddedServerConfig.token
        : randomUUID()
      const rpcHost = process.env.CRAFT_RPC_HOST
        ?? (serverModeEnabled ? '0.0.0.0' : '127.0.0.1')
      const rpcPort = process.env.CRAFT_RPC_PORT
        ? parseInt(process.env.CRAFT_RPC_PORT, 10)
        : (serverModeEnabled ? embeddedServerConfig.port : 0)

      // Load TLS certificates if configured
      let tls: import('@craft-agent/server-core/transport').WsRpcTlsOptions | undefined
      if (serverModeEnabled && embeddedServerConfig.tlsCertPath && embeddedServerConfig.tlsKeyPath) {
        try {
          tls = {
            cert: readFileSync(embeddedServerConfig.tlsCertPath),
            key: readFileSync(embeddedServerConfig.tlsKeyPath),
          }
          mainLog.info('[server-mode] TLS enabled')
        } catch (err) {
          mainLog.error('[server-mode] Failed to load TLS certificates:', err)
        }
      }

      if (serverModeEnabled) {
        mainLog.info(`[server-mode] Enabled — binding ${rpcHost}:${rpcPort}${tls ? ' (TLS)' : ''}`)
      }

      // Bootstrap the WS RPC server via shared bootstrap function.
      const instance = await bootstrapServer<SessionManager, HandlerDeps>({
        serverToken,
        rpcHost,
        rpcPort,
        tls,
        bundledAssetsRoot: __dirname,
        serverId: 'local',
        serverVersion: app.getVersion(),
        platformFactory: () => platform,
        applyPlatformToSubsystems: (p) => {
          setFetcherPlatform(p)
          setSessionPlatform(p)
          setSessionRuntimeHooks({
            updateBadgeCount,
            onSessionStarted,
            onSessionStopped,
            ensureManagedModelAccessToken: async (forceRefresh) => {
              if (serverModeEnabled) {
                throw new Error('Default AI access is unavailable while shared server mode is enabled')
              }
              const result = await authService.ensureModelAccessToken({ force: forceRefresh === true })
              return result
            },
            whenSubprocessEnvReady: whenShellEnvReady,
          })
          setSearchPlatform(p)
          setImageProcessor(p.imageProcessor)
        },
        createSessionManager: () => {
          const sm = new SessionManager()
          sm.setBrowserPaneManager(browserPaneManager!)
          return sm
        },
        createHandlerDeps: ({ sessionManager: sm, platform: p, oauthFlowStore: ofs }) => {
          // The messaging handle is built here because it needs sessionManager.
          // The WS publisher is attached after bootstrapServer resolves (via
          // handle.setPublisher) because wsServer isn't available yet.
          messagingHandle = createMessagingBootstrap({
            sessionManager: sm,
            credentialManager: getCredentialManager(),
            getMessagingDir: (wsId: string) =>
              join(homedir(), '.craft-agent', 'workspaces', wsId, 'messaging'),
            getLegacyMessagingDir: (wsId: string) => {
              const ws = getWorkspaces().find((w) => w.id === wsId)
              return ws ? join(ws.rootPath, 'messaging') : undefined
            },
            // Route messaging diagnostics through the dedicated messaging log
            // at ~/.craft-agent/logs/messaging-gateway.log.
            logger: messagingGatewayLog,
            // WhatsApp worker runs under Electron's embedded Node via
            // ELECTRON_RUN_AS_NODE (WhatsAppAdapter defaults nodeBin to
            // process.execPath). In dev we resolve worker.cjs from the
            // monorepo; in packaged builds it's shipped via extraResources
            // (see apps/electron/electron-builder.yml).
            whatsapp: {
              workerEntry: app.isPackaged
                ? join(process.resourcesPath, 'messaging-whatsapp-worker', 'worker.cjs')
                : join(process.cwd(), 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs'),
              pairingMode: 'qr',
            },
          })
          return {
            sessionManager: sm,
            platform: p,
            windowManager: windowManager ?? undefined,
            browserPaneManager: browserPaneManager ?? undefined,
            oauthFlowStore: ofs,
            messagingRegistry: messagingHandle.registry,
            managedModelAccessAvailable: !serverModeEnabled && managedModelAccessConfigured,
          }
        },
        // Headless: register only core handlers (no GUI handlers for browser, settings, etc.)
        // GUI: register all handlers (core + GUI)
        registerAllRpcHandlers: isHeadless
          ? (server, deps, serverCtx) => registerCoreRpcHandlers(server, deps, serverCtx)
          : registerAllRpcHandlers,
        setSessionEventSink: (sm, sink) => sm.setEventSink(sink),
        initializeSessionManager: async (sm) => {
          // Finder/Dock shell discovery exists for Agent subprocesses, not for
          // rendering or editing workspace files, so keep it in runtime phase 2.
          // It is started, not awaited: an interactive login shell costs ~1-2s of
          // the user's dotfiles, and session discovery needs nothing from it.
          // Agent creation awaits it via the whenSubprocessEnvReady hook.
          startShellEnvLoad()
          await sm.initialize()
        },
        deferRuntimeInitialization: !isHeadless,
        initModelRefreshService: () => initModelRefreshService(async (connection) => {
          if (
            connection.managed === true
            && connection.source === 'builtin'
            && isManagedLlmConnectionSlug(connection.slug)
          ) {
            if (serverModeEnabled) return {}
            const result = await authService.ensureModelAccessToken()
            return { apiKey: result.token }
          }
          const { getCredentialManager } = await import('@craft-agent/shared/credentials')
          return resolveModelRefreshCredentials(connection, getCredentialManager())
        }),
        onClientConnected: ({ clientId, webContentsId }) => {
          if (webContentsId != null) clientMap.set(webContentsId, clientId)
        },
        cleanupClientResources: (clientId) => {
          for (const [wcId, cId] of clientMap) {
            if (cId === clientId) { clientMap.delete(wcId); break }
          }
          cleanupSessionFileWatchForClient(clientId)
        },
      })

      // Capture module-level references for before-quit cleanup and deep-link handlers
      sessionManager = instance.sessionManager
      oauthFlowStore = instance.oauthFlowStore
      moduleSink = instance.wsServer.push.bind(instance.wsServer)
      moduleClientResolver = resolveClientId

      const initializeMessagingGateway = async (): Promise<void> => {
        // The messaging registry depends on initialized sessions and automations,
        // so it belongs to the deferred runtime phase rather than shell startup.
        try {
          if (!messagingHandle) {
            throw new Error('Messaging handle was not constructed in createHandlerDeps')
          }

          messagingHandle.setPublisher(instance.wsServer.push.bind(instance.wsServer))

          // Skip remote-owned workspaces — messaging runs on the remote server.
          const localWorkspaceIds = getWorkspaces()
            .filter((ws) => !ws.remoteServer)
            .map((ws) => ws.id)
          await messagingHandle.initializeWorkspaces(localWorkspaceIds)

          // Compose fan-out event sink: RPC push + messaging gateway dispatch.
          // Always install — this lets workspaces enable messaging at runtime
          // without a process restart.
          const baseSink = instance.wsServer.push.bind(instance.wsServer)
          instance.sessionManager.setEventSink(messagingHandle.wrapSink(baseSink))
          if (messagingHandle.registry.size > 0) {
            mainLog.info(`[messaging] Fan-out sink active for ${messagingHandle.registry.size} workspace(s)`)
          }
        } catch (err) {
          mainLog.error('[messaging] Gateway initialization failed:', err)
        }
      }

      if (isHeadless) {
        // bootstrapServer remains eager for headless hosts, preserving the
        // guarantee that connection details are printed only after runtime init.
        await initializeMessagingGateway()
      } else {
        let runtimeStartRequested = false
        const startRuntime = (): void => {
          if (runtimeStartRequested) return
          runtimeStartRequested = true
          void instance.startRuntime()
            .then(initializeMessagingGateway)
            .catch((err) => {
              mainLog.error('[runtime] Background initialization failed:', err)
              void instance.stop().catch((stopError) => {
                mainLog.error('[runtime] Failed to stop after background initialization failure:', stopError)
              })
            })
        }

        let runtimeFallback: ReturnType<typeof setTimeout> | null = null
        ipcMain.once('renderer:shell-interactive', () => {
          if (runtimeFallback) clearTimeout(runtimeFallback)
          setImmediate(startRuntime)
        })

        // ready-to-show can fire for the static HTML shell before React is
        // interactive. The renderer owns the real product-readiness signal;
        // this fallback only recovers Agent availability after renderer failure.
        const scheduleRuntimeFallback = (): void => {
          if (runtimeStartRequested) return
          runtimeFallback = setTimeout(startRuntime, 30_000)
        }

        scheduleDeferredRuntime = scheduleRuntimeFallback
      }

      // IPC handlers — preload uses sendSync to get WS connection details

      // Remove workspace from config (cleanup stale entries)
      ipcMain.handle('workspace:setArchived', async (_event, workspaceId: string, archived: boolean) => {
        const { setWorkspaceArchived } = await import('@craft-agent/shared/config')
        return setWorkspaceArchived(workspaceId, archived)
      })

      ipcMain.handle('workspace:remove', async (_event, workspaceId: string) => {
        const { removeWorkspace: remove } = await import('@craft-agent/shared/config')
        return remove(workspaceId)
      })

      // Cross-server RPC — invoke a channel on an arbitrary remote server
      ipcMain.handle('server:invokeOnServer', async (_event, url: string, token: string, channel: string, ...args: unknown[]) => {
        const { connectToRemote } = await import('./handlers/workspace')
        const { client, error } = await connectToRemote(url, token)
        if (!client) throw new Error(error ?? 'Connection failed')
        try {
          return await client.invoke(channel, ...args)
        } finally {
          client.destroy()
        }
      })

      // Transfer one immutable summary snapshot to a fresh session on another
      // server. Provider transcripts and workspace files never cross domains.
      ipcMain.handle('session:transferToRemoteWorkspace', async (_event, sessionId: string, targetWorkspaceId: string) => {
        const { resolveRuntimeWorkspace } = await import('@craft-agent/shared/workspaces')
        const { connectToRemote } = await import('./handlers/workspace')

        const targetWorkspace = resolveRuntimeWorkspace(targetWorkspaceId)
        if (!targetWorkspace) throw new Error(`Target workspace ${targetWorkspaceId} not found`)
        if (!sessionManager) throw new Error('Session manager not initialized')

        const sourceWorkspaceLocalId = windowManager?.getWorkspaceForWindow(_event.sender.id)
        if (!sourceWorkspaceLocalId) throw new Error('Unable to resolve source workspace for transfer')

        const sourceWorkspace = resolveRuntimeWorkspace(sourceWorkspaceLocalId)
        if (!sourceWorkspace) throw new Error(`Source workspace ${sourceWorkspaceLocalId} not found`)

        let transferPayload: import('@craft-agent/shared/protocol').RemoteSessionTransferPayload

        if (sourceWorkspace.remoteServer) {
          const { url: sourceUrl, remoteWorkspaceId: sourceRemoteWorkspaceId } = sourceWorkspace.remoteServer
          const sourceToken = await getCredentialManager().getRemoteServerToken(sourceWorkspace.id)
          if (!sourceToken) throw new Error('Source remote server credential is unavailable')
          console.log(`[Transfer] Exporting remote-owned session ${sessionId} from workspace ${sourceRemoteWorkspaceId}...`)
          const { client: sourceClient, error: sourceError } = await connectToRemote(sourceUrl, sourceToken, sourceRemoteWorkspaceId)
          if (!sourceClient) throw new Error(sourceError ?? 'Connection failed to source remote server')

          try {
            transferPayload = await sourceClient.invoke('sessions:exportRemoteTransfer', sessionId)
            if (!transferPayload?.summary) throw new Error(`Failed to summarize session ${sessionId}`)
          } finally {
            sourceClient.destroy()
          }
        } else {
          const payload = await sessionManager.exportRemoteSessionTransfer(sessionId, sourceWorkspace.id)
          if (!payload) throw new Error(`Failed to summarize session ${sessionId}`)
          transferPayload = payload
        }

        if (!targetWorkspace.remoteServer) {
          return sessionManager.importRemoteSessionTransfer(
            targetWorkspace.id,
            transferPayload,
          )
        }

        const { url, remoteWorkspaceId } = targetWorkspace.remoteServer
        const token = await getCredentialManager().getRemoteServerToken(targetWorkspace.id)
        if (!token) throw new Error('Target remote server credential is unavailable')
        console.log(`[Transfer] Connecting to target remote server: ${url}`)
        const { client, error } = await connectToRemote(url, token, remoteWorkspaceId)
        if (!client) throw new Error(error ?? 'Connection failed to target remote server')
        console.log('[Transfer] Connected to target remote server')

        try {
          const result = await client.invoke(
            'sessions:importRemoteTransfer',
            remoteWorkspaceId,
            transferPayload,
          )
          return result
        } finally {
          client.destroy()
        }
      })

      // App relaunch (for server config changes — NOT an update install)
      ipcMain.handle('app:relaunch', () => {
        app.relaunch()
        app.exit(0)
      })

      // Language change: sync from renderer to main process and rebuild native menu
      ipcMain.handle('i18n:changeLanguage', async (_event, lang: string) => {
        i18n.changeLanguage(lang)
        const { rebuildMenu } = await import('./menu')
        await rebuildMenu()
      })

      ipcMain.on('__get-ws-port', (e) => {
        e.returnValue = instance.port
      })
      ipcMain.on('__get-ws-token', (e) => {
        e.returnValue = instance.token
      })
      ipcMain.on('__get-workspace-remote-config', (e) => {
        const wsId = windowManager?.getWorkspaceForWindow(e.sender.id)
        if (!wsId) { e.returnValue = null; return }
        const ws = getWorkspaceByNameOrId(wsId)
        if (!ws?.remoteServer) { e.returnValue = null; return }
        e.returnValue = {
          url: ws.remoteServer.url,
          token: getCredentialManager().peekRemoteServerToken(ws.id) ?? '',
          remoteWorkspaceId: ws.remoteServer.remoteWorkspaceId,
        }
      })
      ipcMain.on('__get-remote-server-token', (e, credentialRef: unknown) => {
        if (typeof credentialRef !== 'string') { e.returnValue = null; return }
        const workspace = getWorkspaces().find(
          candidate => candidate.remoteServer?.credentialRef === credentialRef,
        )
        e.returnValue = workspace
          ? getCredentialManager().peekRemoteServerToken(workspace.id)
          : null
      })

      // Server config RPC handlers (LOCAL_ONLY — Electron-specific)
      const runningServerState = {
        host: rpcHost,
        port: instance.port,
        tls: !!tls,
        token: serverToken,
        enabled: serverModeEnabled,
      }

      instance.wsServer.handle(RPC_CHANNELS.settings.GET_SERVER_CONFIG, async () => {
        const { getServerConfig: getConfig } = await import('@craft-agent/shared/config')
        return getConfig()
      })

      instance.wsServer.handle(RPC_CHANNELS.settings.SET_SERVER_CONFIG, async (_ctx: unknown, config: unknown) => {
        const { setServerConfig: setConfig } = await import('@craft-agent/shared/config')
        const cfg = config as import('@craft-agent/shared/config/server-config').ServerConfig
        // Validate port range
        if (cfg.port < 1024 || cfg.port > 65535) {
          throw new Error(`Port must be between 1024 and 65535, got ${cfg.port}`)
        }
        // Validate cert/key files exist if provided
        if (cfg.tlsCertPath && !existsSync(cfg.tlsCertPath)) {
          throw new Error(`Certificate file not found: ${cfg.tlsCertPath}`)
        }
        if (cfg.tlsKeyPath && !existsSync(cfg.tlsKeyPath)) {
          throw new Error(`Private key file not found: ${cfg.tlsKeyPath}`)
        }
        setConfig(cfg)
      })

      instance.wsServer.handle(RPC_CHANNELS.settings.GET_SERVER_STATUS, async () => {
        const { getServerConfig: getConfig } = await import('@craft-agent/shared/config')
        const saved = getConfig()
        const protocol = runningServerState.tls ? 'wss' : 'ws'

        // Determine display host (LAN IP if bound to 0.0.0.0)
        let displayHost = runningServerState.host
        if (displayHost === '0.0.0.0' || displayHost === '::') {
          const os = await import('os')
          const nets = os.networkInterfaces()
          for (const name of Object.keys(nets)) {
            for (const net of nets[name] ?? []) {
              if (net.family === 'IPv4' && !net.internal) {
                displayHost = net.address
                break
              }
            }
            if (displayHost !== '0.0.0.0' && displayHost !== '::') break
          }
        }

        // Only compare port/tls/token when at least one side has server mode enabled.
        // When both are disabled, the running port is random — comparing it to the
        // saved default (9100) would always produce a false "restart required" banner.
        const needsRestart = saved.enabled !== runningServerState.enabled
          || ((saved.enabled || runningServerState.enabled) && (
            saved.port !== runningServerState.port
            || (!!saved.tlsCertPath) !== runningServerState.tls
            || (saved.token ?? '') !== runningServerState.token
          ))

        return {
          running: true,
          host: runningServerState.host,
          port: runningServerState.port,
          tls: runningServerState.tls,
          url: `${protocol}://${displayHost}:${runningServerState.port}`,
          token: runningServerState.token,
          needsRestart,
          insecureWarning: isInsecureBind,
        }
      })

      // TLS enforcement — warn when server mode binds to a network address without TLS
      // Mirrors the hard guard in packages/server/src/index.ts but warns instead of blocking,
      // since the user explicitly enabled server mode via UI (may be on a trusted LAN).
      const isInsecureBind = serverModeEnabled && !tls
        && !['127.0.0.1', 'localhost', '::1'].includes(rpcHost)
      if (isInsecureBind) {
        mainLog.warn(
          '[server-mode] WARNING: Listening on a network address without TLS. ' +
          'Auth tokens will be sent in cleartext. ' +
          'Configure TLS certificates in Settings > Server.'
        )
      }

      // Wire EventSink to Electron-specific services
      // Must happen BEFORE createInitialWindows() so event handlers use WS from the start
      windowManager.setRpcEventSink(moduleSink!, resolveClientId)
      const { setMenuEventSink } = await import('./menu')
      setMenuEventSink(moduleSink!, resolveClientId)
      const { setNotificationEventSink } = await import('./notifications')
      setNotificationEventSink(moduleSink!, resolveClientId)

      // Headless: print connection details
      if (isHeadless) {
        console.log(`CRAFT_SERVER_URL=${instance.protocol}://${instance.host}:${instance.port}`)
        console.log(`CRAFT_SERVER_TOKEN=${instance.token}`)
      }
    }

    // Create initial windows (restores from saved state or opens first workspace)
    // In headless mode the server runs without any UI — skip window creation.
    mainStartupSucceeded = true
    if (shouldCreateWindowsAfterStartup({
      initSucceeded: mainStartupSucceeded,
      isHeadless,
    })) {
      await createInitialWindows()
    }
    scheduleDeferredRuntime?.()

    // Run credential health check at startup to detect issues early
    // (corruption, machine migration, missing credentials for default connection)
    // Skip in thin-client mode — credentials are managed by the remote server.
    if (!isClientOnly) {
      try {
        const { getCredentialManager } = await import('@craft-agent/shared/credentials')
        const credentialManager = getCredentialManager()
        const health = await credentialManager.checkHealth()
        if (!health.healthy) {
          mainLog.warn('Credential health check failed:', health.issues)
          // Issues will be displayed in Settings → AI when user navigates there
        }
      } catch (err) {
        mainLog.error('Credential health check error:', err)
      }
    }

    // Initialize power manager (loads setting, must happen after config is available)
    // Non-critical — powerSaveBlocker may not work on headless/xvfb setups
    try {
      const { initPowerManager } = await import('./power-manager')
      await initPowerManager()
    } catch (err) {
      mainLog.warn('[power] Power manager init failed (non-critical):', err instanceof Error ? err.message : err)
    }

    // Initialize auto-update (check immediately on launch)
    // Skip in dev mode to avoid replacing /Applications app and launching it instead
    if (moduleSink) setAutoUpdateEventSink(moduleSink)
    if (app.isPackaged) {
      const launchUpdateDecision = consumeLaunchUpdateCheckDecision({
        userDataDir: app.getPath('userData'),
        currentVersion: getAppVersion(),
      })

      if (launchUpdateDecision.shouldCheck) {
        checkForUpdatesOnLaunch().catch(err => {
          mainLog.error('[auto-update] Launch check failed:', err)
        })
      } else {
        mainLog.info(`[auto-update] Skipping launch check: ${launchUpdateDecision.reason}`)
      }
    } else {
      mainLog.info('[auto-update] Skipping auto-update in dev mode')
    }

    // Process pending deep link from cold start
    if (pendingDeepLink) {
      mainLog.info('Processing pending deep link:', pendingDeepLink)
      await handleDeepLink(pendingDeepLink, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined)
      pendingDeepLink = null
    }

    mainLog.info('Desktop shell initialized successfully')
    if (isDebugMode) {
      mainLog.info('Debug mode enabled - logs at:', getLogFilePath())
    }
    mainLog.info('Messaging gateway log path:', getMessagingGatewayLogFilePath())
  } catch (error) {
    mainStartupSucceeded = false
    mainLog.error('Failed to initialize app:', error instanceof Error ? error.message : error, (error as any)?.stack)
    releaseServerLock()
    if (!mainStartupIsHeadless) {
      dialog.showErrorBox(
        'Storyflow failed to start',
        error instanceof Error ? error.message : String(error),
      )
      app.quit()
    }
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (
      BrowserWindow.getAllWindows().length === 0
      && windowManager
      && shouldCreateWindowsAfterStartup({
        initSucceeded: mainStartupSucceeded,
        isHeadless: mainStartupIsHeadless,
      })
    ) {
      const workspaces = getWorkspaces()
      windowManager.createWindow({ workspaceId: resolveActivateWindowWorkspaceId(workspaces) })
    }
  })
})

app.on('window-all-closed', () => {
  if (process.env.CRAFT_HEADLESS) return  // headless server stays alive
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

const quitCoordinator = createQuitCoordinator({
  isUpdating,
  prepare: async () => {
    // Ensure Cmd+Q/app quit bypasses layered window close interception (Cmd+W behavior).
    windowManager?.setAppQuitting(true)
    await managedCapabilityBroker?.close().catch(error => {
      mainLog.warn('[managed-capability] Failed to close local capability broker:', error)
    })
    managedCapabilityBroker = null
    delete process.env[MODEL_ACCESS_BROKER_URL_ENV]
    delete process.env[MODEL_ACCESS_BROKER_TOKEN_ENV]
    delete process.env[TOOL_BROKER_URL_ENV]
    delete process.env[TOOL_BROKER_TOKEN_ENV]
    clientAuthService?.dispose()
    clientAuthService = null

    if (windowManager) {
      // Get full window states (includes bounds, type, and query)
      const windows = windowManager.getWindowStates()
      // Get the focused window's workspace as last focused
      const focusedWindow = BrowserWindow.getFocusedWindow()
      let lastFocusedWorkspaceId: string | undefined
      if (focusedWindow) {
        lastFocusedWorkspaceId = windowManager.getWorkspaceForWindow(focusedWindow.webContents.id) ?? undefined
      }

      if (shouldSaveOpenWindowsOnQuit(windows.length)) {
        saveWindowState({
          windows,
          lastFocusedWorkspaceId,
        })
        mainLog.info('Saved window state:', windows.length, 'windows')
      } else {
        mainLog.info('Preserved last closed window state for next launch')
      }
    }

    if (sessionManager) {
      try {
        await sessionManager.flushAllSessions()
        mainLog.info('Flushed all pending session writes')
      } catch (error) {
        mainLog.error('Failed to flush sessions:', error)
      }
      sessionManager.cleanup()
    }

    browserPaneManager?.destroyAll()
    oauthFlowStore?.dispose()
    getModelRefreshService().stopAll()

    // Stop messaging gateways so the WhatsApp worker subprocess exits cleanly.
    if (messagingHandle) {
      try {
        await messagingHandle.dispose()
      } catch (err) {
        mainLog.error('[messaging] dispose failed:', err)
      }
    }

    const { cleanup: cleanupPowerManager } = await import('./power-manager')
    cleanupPowerManager()

    // Release the server lock file so the next launch doesn't see a stale PID.
    releaseServerLock()
  },
  exit: code => app.exit(code),
})

// The updater must finish the same cleanup before it takes ownership of the
// native quit flow. The coordinator makes this idempotent across all exit paths.
setUpdateInstallPreparation(quitCoordinator.prepare)

app.on('before-quit', async (event) => {
  if (isUpdating()) {
    mainLog.info('Update in progress, letting electron-updater handle quit')
  }
  await quitCoordinator.handleBeforeQuit(event)
})

process.on('uncaughtException', (error) => {
  mainLog.error('Uncaught exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  mainLog.error('Unhandled rejection at:', promise, 'reason:', reason)
})
