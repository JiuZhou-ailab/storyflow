// input: Renderer-facing ElectronAPI calls and authored demo fixtures
// output: Isolated in-memory files, sessions and deterministic writing events
// pos: The only demo replacement for the Product Host; no network/runtime fallback
import type { ElectronAPI, Session, SessionEvent, LlmConnectionWithStatus, FileSearchResult } from '../../../electron/src/shared/types'
import { workspace, initialFiles, initialSession, scenarios, type ScenarioId } from './fixture'

export function createDemoAdapter(notice: (message: string) => void) {
  const files = new Map(Object.entries(initialFiles))
  const sessions = new Map<string, Session>([[initialSession.id, structuredClone(initialSession)]])
  const listeners = new Set<(event: SessionEvent) => void>()
  const versions = new Map<string, Map<string, string>>()
  const drafts: Record<string, { text: string }> = {}
  let disposed = false
  let selected: { id: ScenarioId; sessionId: string } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const copy = <T,>(value: T): T => structuredClone(value)
  const emit = (event: SessionEvent) => { if (!disposed) for (const listener of listeners) listener(copy(event)) }
  const unsupported = () => {
    const message = '此功能不在交互演示中开放。请下载 Storyflow 后使用。'
    notice(message)
    throw new Error(message)
  }
  const checkRoot = (root: string) => { if (root !== workspace.rootPath) throw new Error('无法访问示例项目以外的文件。') }
  const read = (path: string) => {
    const content = files.get(path)
    if (content === undefined) throw new Error('示例文件不存在或不在当前项目中。')
    return content
  }
  const getSession = (id: string) => {
    const session = sessions.get(id)
    if (!session) throw new Error('示例对话不存在。')
    return session
  }
  const listFiles = (root: string): FileSearchResult[] => {
    checkRoot(root)
    return [...files.keys()].map(path => ({ path, name: path.split('/').at(-1)!, relativePath: path.slice(root.length + 1), type: 'file' }))
  }
  const connection: LlmConnectionWithStatus = {
    slug: 'demo-local', name: '示例任务', providerType: 'pi', authType: 'none',
    models: [{ id: 'demo', name: '本地演示', shortName: '本地演示', description: '预设示例结果', provider: 'pi', contextWindow: 200000 }], defaultModel: 'demo',
    isAuthenticated: true, isDefault: true, createdAt: 1,
  }
  const api = {
    getRuntimeEnvironment: () => 'web', getVersions: () => ({ node: '', chrome: '', electron: '' }),
    isChannelAvailable: () => false, isDebugMode: async () => false,
    debugLog: () => {}, reportRendererCrash: (error) => notice(error.error),
    notifyShellInteractive: () => {},
    getHomeDir: async () => workspace.rootPath, getServerHomeDir: async () => workspace.rootPath,
    getWindowWorkspace: async () => workspace.id, getWindowMode: async () => 'workspace',
    getWorkspaces: async () => [copy(workspace)], resolveRuntimeWorkspace: async (id) => id === workspace.id ? copy(workspace) : null,
    getClientAuthState: async () => ({ required: false, configured: false, authenticated: false, emailPasswordEnabled: false, emailSignUpEnabled: false, feishuLoginEnabled: false }),
    getTransportConnectionState: async () => ({ mode: 'local', status: 'connected', url: '', attempt: 0, updatedAt: 1 }),
    getSessions: async () => copy([...sessions.values()]),
    listSessionsByWorkspace: async (id) => id === workspace.id ? copy([...sessions.values()]) : [],
    getSessionMessages: async (id) => copy(getSession(id)), releaseSessionMessages: async () => true,
    getActiveSessions: async () => [],
    getUnreadSummary: async () => ({ totalUnreadSessions: 0, byWorkspace: {}, hasUnreadByWorkspace: {} }),
    getWindowFocusState: async () => true,
    getPendingPlanExecution: async () => null,
    readPreferences: async () => ({ content: '', exists: false, path: '' }),
    getAutoCapitalisation: async () => false, getSpellCheck: async () => false,
    getAutomations: async () => ({ automations: {} }),
    getAutomationLastExecuted: async () => ({}),
    getUpdateInfo: async () => ({ available: false, currentVersion: '0.21.3', latestVersion: null, downloadState: 'idle', downloadProgress: 0 }),
    getSessionPermissionModeState: async () => ({ permissionMode: 'allow-all', modeVersion: 1, changedAt: new Date(0).toISOString(), changedBy: 'restore' }),
    getAllDrafts: async () => copy(drafts), setDraft: async (id, draft) => { drafts[id] = copy(draft) },
    readFile: async (path) => read(path),
    writeFile: async (path, content) => { read(path); files.set(path, content) },
    listWorkspaceFiles: async (root) => listFiles(root),
    searchFiles: async (root, query) => listFiles(root).filter(file => file.relativePath.includes(query)),
    searchFilesBatch: async (root, requests) => requests.map(({ query }) => ({ query, results: listFiles(root).filter(file => file.relativePath.includes(query)) })),
    getFilePath: () => null,
    getWorkspaceSettings: async () => ({ name: workspace.name, defaultLlmConnection: connection.slug, model: 'demo', permissionMode: 'allow-all', workingDirectory: workspace.rootPath, localMcpEnabled: false, automationsEnabled: false }),
    listLlmConnectionsWithStatus: async () => [copy(connection)],
    getSources: async () => [], getSkills: async () => [],
    listStatuses: async () => [], listLabels: async () => [], listViews: async () => [],
    getNotificationsEnabled: async () => false, getSystemWarnings: async () => ({ vcredistMissing: false }),
    getSendMessageKey: async () => 'enter',
    getWhatsNewManifest: async () => undefined, getLatestReleaseVersion: async () => undefined,
    getAppTheme: async () => null, getColorTheme: async () => 'default', getWorkspaceColorTheme: async () => null,
    getSystemTheme: async () => false,
    onSessionEvent: (callback) => { listeners.add(callback); return () => { listeners.delete(callback) } },
    createWorkspaceVersion: async (root) => {
      checkRoot(root)
      const hash = String(versions.size + 1)
      versions.set(hash, new Map(files))
      return { created: true, commitHash: hash, changedFiles: 0 }
    },
    getWorkspaceVersionStatus: async (root) => { checkRoot(root); return { isGitRepo: false, hasChanges: false, lastCommit: null } },
    listWorkspaceVersions: async (root) => { checkRoot(root); return [] },
    readWorkspaceFileAtVersion: async (root, hash, relative) => { checkRoot(root); return versions.get(hash)?.get(`${root}/${relative}`) ?? null },
    compareWorkspaceVersions: async (root, base, head) => {
      checkRoot(root)
      const before = versions.get(base)
      const after = head ? versions.get(head) : files
      if (!before || !after) throw new Error('示例版本不存在。')
      return [...after].filter(([path, text]) => before.get(path) !== text).map(([path]) => ({ path: path.slice(root.length + 1), status: 'modified' as const }))
    },
    sessionCommand: async (id, command) => {
      getSession(id)
      if (['setActiveViewing', 'markRead'].includes(command.type)) return
      return unsupported()
    },
    sendMessage: async (id, message, attachments, stored, options) => {
      const session = getSession(id)
      const scenario = selected?.sessionId === id ? scenarios[selected.id] : undefined
      if (!scenario || message.trim() !== scenario.prompt || attachments?.length || stored?.length) {
        notice('请选择上方的示例任务。自由输入已保留，连接真实模型后才能执行。')
        queueMicrotask(() => { if (!disposed) window.dispatchEvent(new CustomEvent('craft:insert-text', { detail: { text: message, sessionId: id } })) })
        throw new Error('本页仅执行预设示例任务，输入内容已保留。')
      }
      if (session.isProcessing) throw new Error('示例任务正在处理中。')
      const path = `${workspace.rootPath}/第01章.md`
      const before = read(path)
      if (before.includes(scenario.after) || before.split(scenario.before).length !== 2) {
        notice('目标段落已改变，无法安全运行此示例。请重置体验后再试。')
        throw new Error('目标段落已改变或出现多次，文件保持不变。')
      }
      session.isProcessing = true
      const turnId = crypto.randomUUID()
      const user = { id: options?.optimisticMessageId ?? crypto.randomUUID(), role: 'user' as const, content: message, timestamp: Date.now() }
      session.messages.push(user)
      emit({ type: 'user_message', sessionId: id, message: user, optimisticMessageId: options?.optimisticMessageId, status: 'accepted' })
      timer = setTimeout(() => {
        const current = read(path)
        if (current.split(scenario.before).length !== 2) {
          emit({ type: 'error', sessionId: id, error: '目标段落已改变，文件保持不变。' })
        } else {
          const toolUseId = crypto.randomUUID()
          const toolInput = { file_path: path, old_string: scenario.before, new_string: scenario.after }
          emit({ type: 'tool_start', sessionId: id, toolName: 'Edit', toolUseId, toolInput, turnId })
          files.set(path, current.replace(scenario.before, scenario.after))
          session.messages.push({ id: toolUseId, role: 'tool', toolName: 'Edit', toolUseId, toolInput, toolStatus: 'completed', content: '已更新第01章.md', turnId, timestamp: Date.now() })
          emit({ type: 'tool_result', sessionId: id, toolUseId, toolName: 'Edit', result: '已更新第01章.md', turnId })
          const text = '示例任务已完成。打开 [第01章.md](第01章.md)，查看这次改动，再决定接受或拒绝。'
          session.messages.push({ id: `${turnId}-result`, role: 'assistant', content: text, turnId, timestamp: Date.now() })
          emit({ type: 'text_complete', sessionId: id, text, turnId })
        }
        session.isProcessing = false
        emit({ type: 'complete', sessionId: id })
      }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900)
    },
    cancelProcessing: async (id) => { clearTimeout(timer); getSession(id).isProcessing = false; emit({ type: 'complete', sessionId: id }) },
  } satisfies Partial<ElectronAPI>

  // These host events have no external producer in a browser-only demo.
  const quietEvents = new Set<string>([
    'onClientAuthStateChanged', 'onTransportConnectionStateChanged', 'onReconnected',
    'onAppThemeChange', 'onLlmConnectionsChanged', 'onSystemThemeChange',
    'onSourcesChanged', 'onSkillsChanged', 'onUnreadSummaryChanged', 'onMenuNewChat',
    'onMenuOpenSettings', 'onMenuKeyboardShortcuts', 'onMenuToggleSidebar', 'onCloseRequested',
    'onNotificationNavigate', 'onUpdateAvailable', 'onUpdateDownloadProgress',
    'onThemePreferencesChange', 'onWorkspaceThemeChange',
    'onDeepLinkNavigate', 'onStatusesChanged', 'onLabelsChanged', 'onAutomationsChanged',
    'onWindowFocusChange',
  ] satisfies (keyof ElectronAPI)[])
  const host = new Proxy(api, {
    get(target, name) {
      if (name in target) return Reflect.get(target, name)
      if (quietEvents.has(String(name))) return () => () => {}
      return async () => { console.warn(`[demo] Unsupported host operation: ${String(name)}`); return unsupported() }
    },
  }) as unknown as ElectronAPI
  return {
    api: host,
    select(id: ScenarioId, sessionId: string) { getSession(sessionId); selected = { id, sessionId } },
    dispose() { disposed = true; clearTimeout(timer); listeners.clear() },
  }
}
