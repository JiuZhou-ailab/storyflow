import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Provider, createStore } from 'jotai'
import { ActivityRail } from '../ActivityRail'
import { FocusProvider } from '@/context/FocusContext'
import { setupI18n } from '@craft-agent/shared/i18n'
import { initReactI18next } from 'react-i18next'
import type { Workspace } from '../../../../shared/types'

async function run() {
  setupI18n([initReactI18next])
  const calls: string[] = []
  const listeners = new Set<(event: any) => void>()
  const api = {
    listSessionsByWorkspace: async (id: string) => {
      calls.push(id)
      await new Promise(resolve => setTimeout(resolve, 400))
      return [{ id: `session-${id}`, workspaceId: id, name: `Pinned ${id}`, isPinned: true, createdAt: 1, lastMessageAt: 1, messageCount: 1, messages: [] }]
    },
    getActiveSessions: async () => [],
    getUnreadSummary: async () => ({ hasUnreadByWorkspace: {} }),
    onUnreadSummaryChanged: () => () => {},
    onSessionEvent: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  Object.defineProperty(window, 'electronAPI', { value: api, configurable: true })
  const root = createRoot(document.getElementById('root')!)
  const store = createStore()
  const projects: Workspace[] = ['alpha', 'beta'].map(id => ({ id, name: id, slug: id, rootPath: `/fixture/${id}`, createdAt: 1 }))
  const draw = (workspaces: Workspace[]) => flushSync(() => root.render(
    <Provider store={store}><FocusProvider><ActivityRail workspaces={workspaces} activeItem="writing" onSelectSession={() => {}} /></FocusProvider></Provider>,
  ))
  const settle = () => new Promise(resolve => setTimeout(resolve, 650))
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
  try {
    draw(projects)
    await new Promise(resolve => setTimeout(resolve, 100))
    const expand = document.querySelector<HTMLButtonElement>('button[aria-label="项目：alpha"],button[aria-label="Project: alpha"]')
    check(expand, 'Project expansion must be available during metadata loading')
    expand!.click()
    await new Promise(resolve => setTimeout(resolve, 500))
    check(calls.filter(id => id === 'alpha').length === 1 && calls.filter(id => id === 'beta').length === 1, 'Initial catalog must query each project once')
    check(document.body.textContent?.includes('Pinned alpha') && document.body.textContent?.includes('Pinned beta'), 'Collapsed projects must retain cross-project pinned conversations')
    draw(projects.map(p => ({ ...p, name: `${p.name} renamed`, lastAccessedAt: 20 })))
    await settle()
    check(calls.filter(id => id === 'alpha').length === 1 && calls.filter(id => id === 'beta').length === 1, 'Display-only catalog updates must not refetch project histories')
    draw(projects.map(p => p.id === 'alpha' ? { ...p, rootPath: '/fixture/relinked' } : { ...p }))
    await settle()
    check(calls.filter(id => id === 'alpha').length === 2 && calls.filter(id => id === 'beta').length === 1, 'Relinking must refresh only the changed project')
    draw(projects.map(p => ({ ...p, rootAvailable: false })))
    await settle()
    const beforeRecovery = calls.length
    draw(projects)
    await settle()
    check(calls.length === beforeRecovery + 2, 'Recovered project roots must reload histories')
    const beforeEvent = calls.filter(id => id === 'beta').length
    for (const listener of listeners) listener({ type: 'session_pinned', sessionId: 'other' })
    await settle()
    check(calls.filter(id => id === 'beta').length === beforeEvent + 1, 'Session events must still refresh cached cross-project pins')
    return { calls, pinnedVisible: true, relinkRefreshed: true, eventRefreshed: true }
  } finally { root.unmount() }
}
run().then(result => parent.postMessage({ railProbe: { result } }, '*'), error => parent.postMessage({ railProbe: { error: String(error) } }, '*'))
