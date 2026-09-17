// input: The demo iframe document
// output: Isolated storage/host installed before the real renderer imports
// pos: Browser-only entry; unavailable services never reach the network
import { createDemoAdapter } from './adapter'
import { initialSession, scenarios, workspace, type ScenarioId } from './fixture'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(String(key)) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(String(key)) }
  setItem(key: string, value: string) { this.values.set(String(key), String(value)) }
}
Object.defineProperty(window, 'localStorage', { value: new MemoryStorage() })
Object.defineProperty(window, 'sessionStorage', { value: new MemoryStorage() })
localStorage.setItem('i18nextLng', 'zh')
localStorage.setItem('craft-theme', JSON.stringify({ mode: 'light', colorTheme: 'default', font: 'system', isUserOverride: true }))
localStorage.setItem('craft-writing-workspace-visible', 'true')
localStorage.setItem('craft-activity-rail-visible', 'false')
localStorage.setItem('craft-first-run-tour-completed', 'true')
localStorage.setItem(`craft-last-selected-session-id:${workspace.id}`, JSON.stringify(initialSession.id))
const params = new URLSearchParams({ workspaceId: workspace.id, ws: workspace.slug, route: `allSessions/session/${initialSession.id}` })
history.replaceState(null, '', `${location.pathname}?${params}`)

const notice = (message: string) => { document.getElementById('demo-notice')!.textContent = message }
const demo = createDemoAdapter(notice)
let openedInitialFile = false
let readyTimer: ReturnType<typeof setTimeout> | undefined
// Prime the desktop through the same file link a visitor uses, after route restoration.
// Keep this coupling in the demo host; the product's initial project state stays unchanged.
const readyObserver = new MutationObserver(() => {
  clearTimeout(readyTimer)
  const links = document.querySelectorAll<HTMLAnchorElement>('ul a[href="%E7%AC%AC01%E7%AB%A0.md"]')
  if (links.length !== 1 || document.querySelectorAll('[role="textbox"]').length !== 1) return
  const link = links[0]
  if (matchMedia('(min-width: 768px)').matches) {
    if (!openedInitialFile) { openedInitialFile = true; link.click(); return }
    if (!document.querySelector('.tiptap[contenteditable="true"]')) return
  }
  // Route restoration can briefly mount both the outgoing and incoming transcript.
  readyTimer = setTimeout(() => {
    readyObserver.disconnect()
    document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => { button.disabled = false })
    notice('点击第01章.md打开正文，或选择上方的示例任务。')
    window.parent.postMessage({ type: 'storyflow-demo-ready' }, location.origin)
  }, 300)
})
readyObserver.observe(document.getElementById('root')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] })
window.electronAPI = demo.api
const fetchResource = window.fetch.bind(window)
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input instanceof Request ? input : new URL(String(input), location.href), init)
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/demo/assets/')) {
    return Promise.reject(new Error('交互演示不连接业务服务。'))
  }
  return fetchResource(request)
}) as typeof window.fetch
const unavailable = () => { throw new Error('交互演示不连接外部服务。') }
window.WebSocket = class { constructor() { unavailable() } } as unknown as typeof WebSocket
window.EventSource = class { constructor() { unavailable() } } as unknown as typeof EventSource
window.XMLHttpRequest = class { constructor() { unavailable() } } as unknown as typeof XMLHttpRequest
navigator.sendBeacon = () => false

document.getElementById('demo-reset')!.addEventListener('click', () => { clearTimeout(readyTimer); readyObserver.disconnect(); demo.dispose(); location.reload() })
document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => {
  button.addEventListener('click', () => {
    const id = button.dataset.scenario as ScenarioId
    demo.select(id, initialSession.id)
    window.dispatchEvent(new CustomEvent('craft:insert-text', { detail: { text: scenarios[id].prompt, sessionId: initialSession.id } }))
    notice('示例请求已填入输入区，发送后可查看文件改动。')
  })
})
window.addEventListener('pagehide', () => { clearTimeout(readyTimer); readyObserver.disconnect(); demo.dispose() }, { once: true })
import('./main').catch(error => {
  notice('示例项目加载失败，请重置体验后重试。')
  window.parent.postMessage({ type: 'storyflow-demo-error' }, location.origin)
  console.error(error)
})
