// input: Mixed-workspace session metadata delivered through the rail's RPC and atom paths
// output: Behavioral proof that the rail renders Free Conversations only
// pos: Enforces the ADR 0006 ownership boundary at the surface that broke it

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Provider, createStore } from 'jotai'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
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

beforeAll(async () => {
  ActivityRail = (await import('../ActivityRail')).ActivityRail
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
      </Provider>
    )

    expect(html).not.toContain('九州项目对话')
    expect(html).not.toContain('data-session-id="project-1"')
    // The project itself still belongs in the rail — only its conversations do not.
    expect(html).toContain('九州')
  })

  it('labels the section by its domain rather than as a global recent list', () => {
    installElectronApi()
    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <ActivityRail activeItem="recent" onOpenFreeConversations={() => {}} />
      </Provider>
    )

    expect(html).toContain('自由对话')
    expect(html).not.toContain('最近对话')
  })

  it('creates a fresh free conversation instead of only reopening the list', () => {
    const handlerStart = appSource.indexOf('const handleOpenFreeConversations =')
    const handlerEnd = appSource.indexOf('\n\n  useEffect(', handlerStart)
    const handlerSource = appSource.slice(handlerStart, handlerEnd)

    expect(handlerSource).toContain('options?.createNew')
    expect(handlerSource).toContain('routes.action.newSession()')
    expect(handlerSource).toContain('routes.view.allSessions()')
    expect(appShellContextSource).toContain(
      'onOpenFreeConversations: (options?: { createNew?: boolean }) => void | Promise<void>'
    )
    expect(activityRailSource).toContain('onOpenFreeConversations({ createNew: true })')
  })
})
