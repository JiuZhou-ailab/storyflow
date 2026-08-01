// input: Mixed-workspace metadata plus current-runtime and retained-project navigation state
// output: Behavioral proof that free conversations and the top task action stay in the current runtime domain
// pos: Enforces the ADR 0006 ownership boundary at the surface that broke it

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Provider, createStore } from 'jotai'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { FocusProvider } from '@/context/FocusContext'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const appShellContextSource = readFileSync(new URL('../../../context/AppShellContext.tsx', import.meta.url), 'utf8')
const activityRailSource = readFileSync(new URL('../ActivityRail.tsx', import.meta.url), 'utf8')

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const PROJECT_WORKSPACE_ID = 'workspace-jiuzhou'

function meta(id: string, workspaceId: string, name: string): SessionMeta {
  return {
    id,
    workspaceId,
    name,
    createdAt: 1,
    lastMessageAt: 1,
  } as SessionMeta
}

/**
 * The rail reads sessions from two independent paths:
 *   1. the RPC list, which used to be a cross-workspace `getAllSessions`
 *   2. the local atom overlay, which is scoped to the *running* workspace
 * Static rendering does not run effects, so these tests cover path 2 — the one
 * that leaks even after the server is fixed, because an open project fills that
 * atom with its own sessions. Path 1 is covered by the scoped-channel contract
 * in packages/server-core/src/handlers/rpc/sessions.get-handler.test.ts.
 */
function installElectronApi() {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window ??= {}
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.electronAPI = {
    listSessionsByWorkspace: async (workspaceId: string) => [
      meta('free-1', FREE_CONVERSATION_WORKSPACE_ID, '自由对话记录'),
      meta('project-1', PROJECT_WORKSPACE_ID, '九州项目对话'),
    ].filter(session => session.workspaceId === workspaceId),
    getUnreadSummary: async () => ({
      totalUnreadSessions: 0,
      byWorkspace: {},
      hasUnreadByWorkspace: {},
    }),
    onUnreadSummaryChanged: () => () => {},
    onSessionEvent: () => () => {},
  }
}

let ActivityRail: typeof import('../ActivityRail').ActivityRail
let resolveActivityWorkspaceSessionMetas: typeof import('../ActivityRail').resolveActivityWorkspaceSessionMetas

beforeAll(async () => {
  const activityRailModule = await import('../ActivityRail')
  ActivityRail = activityRailModule.ActivityRail
  resolveActivityWorkspaceSessionMetas = activityRailModule.resolveActivityWorkspaceSessionMetas
})

describe('ActivityRail free-conversation scope', () => {
  it('never renders a project conversation, even when the atom overlay holds one', () => {
    installElectronApi()
    const store = createStore()
    // Mirrors an open project: the workspace-scoped atom is full of its sessions.
    store.set(sessionMetaMapAtom, new Map([
      ['project-1', meta('project-1', PROJECT_WORKSPACE_ID, '九州项目对话')],
      ['free-1', meta('free-1', FREE_CONVERSATION_WORKSPACE_ID, '自由对话记录')],
    ]))

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <FocusProvider>
          <ActivityRail
            activeItem="recent"
            workspaces={[{
              id: PROJECT_WORKSPACE_ID,
              name: '九州',
              slug: 'jiuzhou',
              rootPath: '/tmp/jiuzhou',
              createdAt: 0,
            }]}
            activeWorkspaceId={PROJECT_WORKSPACE_ID}
            onSelectSession={() => {}}
            onOpenFreeConversations={() => {}}
          />
        </FocusProvider>
      </Provider>
    )

    expect(html).not.toContain('九州项目对话')
    expect(html).not.toContain('data-session-id="project-1"')
    expect(html).not.toContain('lucide-message-square-text')
    // The project itself still belongs in the rail — only its conversations do not.
    expect(html).toContain('九州')
  })

  it('labels the section by its domain rather than as a global recent list', () => {
    installElectronApi()
    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <FocusProvider>
          <ActivityRail activeItem="recent" onOpenFreeConversations={() => {}} />
        </FocusProvider>
      </Provider>
    )

    expect(html).toContain('自由对话')
    expect(html).not.toContain('最近对话')
    const createButtonStart = html.indexOf('aria-label="新建任务"')
    const createButton = html.slice(createButtonStart, html.indexOf('</button>', createButtonStart))
    expect(createButton).toContain('新建任务')
    expect(createButton).not.toContain('opacity-0')
  })

  it('creates in the current runtime instead of a retained project', () => {
    const handlerStart = appSource.indexOf('const handleOpenFreeConversations =')
    const handlerEnd = appSource.indexOf('\n\n  useEffect(', handlerStart)
    const handlerSource = appSource.slice(handlerStart, handlerEnd)
    const railStart = appShellSource.indexOf('<ActivityRail\n')
    const railProps = appShellSource.slice(railStart, appShellSource.indexOf('/>', railStart))
    const projectCreateStart = appShellSource.indexOf('const handleActivityProjectSessionCreate =')
    const projectCreateSource = appShellSource.slice(
      projectCreateStart,
      appShellSource.indexOf('\n\n  const handleSidebarFocus', projectCreateStart),
    )

    expect(railProps).toContain('runtimeWorkspaceId={activeWorkspaceId}')
    expect(railProps).toContain('activeWorkspaceId={projectWorkspaceId}')
    expect(handlerSource).toContain('windowWorkspaceId === FREE_CONVERSATION_WORKSPACE_ID')
    expect(handlerSource).toContain('navigate(targetRoute)')
    expect(handlerSource).toContain('options?.createNew')
    expect(handlerSource).toContain('routes.action.newSession()')
    expect(handlerSource).toContain('routes.view.allSessions()')
    expect(activityRailSource).toContain("useFocusZone({ zoneId: 'navigator' })")
    expect(activityRailSource).toContain('tabIndex={-1}')
    expect(appShellContextSource).toContain(
      'onOpenFreeConversations: (options?: { createNew?: boolean }) => void | Promise<void>'
    )
    expect(activityRailSource).toContain('onCreateConversationInProject(activeWorkspaceId)')
    expect(activityRailSource).toContain('onOpenFreeConversations?.({ createNew: true })')
    expect(projectCreateSource).toContain('if (workspaceId === activeWorkspaceId)')
    expect(projectCreateSource.indexOf('navigateToSessionInPanel(session.id)')).toBeLessThan(
      projectCreateSource.indexOf('await onSelectWorkspace(workspaceId)')
    )
  })

  it('treats the active runtime atom as authoritative for create and delete', () => {
    const staleSnapshot = [
      meta('deleted', PROJECT_WORKSPACE_ID, '已删除对话'),
      meta('kept', PROJECT_WORKSPACE_ID, '保留对话'),
    ]
    const liveRuntime = [
      meta('created', PROJECT_WORKSPACE_ID, '刚创建对话'),
      meta('kept', PROJECT_WORKSPACE_ID, '保留对话'),
    ]

    const active = resolveActivityWorkspaceSessionMetas(
      PROJECT_WORKSPACE_ID,
      PROJECT_WORKSPACE_ID,
      staleSnapshot,
      liveRuntime,
    )
    expect(active.map(session => session.id)).toEqual(['created', 'kept'])

    const inactive = resolveActivityWorkspaceSessionMetas(
      PROJECT_WORKSPACE_ID,
      'another-workspace',
      staleSnapshot,
      liveRuntime,
    )
    expect(inactive.map(session => session.id)).toEqual(['deleted', 'kept'])
  })

  it('keeps the rail cache visible while the runtime metadata map hydrates', () => {
    const cachedSnapshot = [meta('cached', PROJECT_WORKSPACE_ID, '缓存对话')]
    const emptyRuntime: SessionMeta[] = []

    const duringHydration = resolveActivityWorkspaceSessionMetas(
      PROJECT_WORKSPACE_ID,
      PROJECT_WORKSPACE_ID,
      cachedSnapshot,
      emptyRuntime,
      false,
    )

    expect(duringHydration.map(session => session.id)).toEqual(['cached'])
  })

  it('renders the Feishu avatar with an initial fallback and follows auth broadcasts', () => {
    installElectronApi()
    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <FocusProvider>
          <ActivityRail
            activeItem="recent"
            profile={{
              name: '飞书用户',
              avatarUrl: 'https://example.com/feishu-avatar.png',
            }}
            onOpenFreeConversations={() => {}}
          />
        </FocusProvider>
      </Provider>
    )

    expect(html).toContain('src="https://example.com/feishu-avatar.png"')
    expect(html).toContain('飞')
    expect(appSource).toContain('avatarUrl: user?.avatarUrl')
    expect(appSource).toContain('onClientAuthStateChanged(setClientAuthState)')
  })
})
