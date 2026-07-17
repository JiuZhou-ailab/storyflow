// input: A DevTools browser WebSocket URL (Electron --remote-debugging-port)
// output: A tiny flat-session CDP client — send commands, await results, subscribe to events, per target
// pos: The transport foundation for the perf harness; replaces Playwright, which cannot CDP-handshake Electron 39

/**
 * Minimal Chrome DevTools Protocol client over a single browser-level WebSocket, using
 * "flat" session mode (Target.attachToTarget {flatten:true}). Every command/event carries an
 * optional sessionId that routes it to a specific page target.
 *
 * Why hand-rolled: playwright-core 1.61 (latest) cannot complete a CDP handshake against
 * Electron 39 / Chrome 142 — both `_electron.launch` and `connectOverCDP` hang. Raw CDP works,
 * so the harness owns a small client rather than depending on a broken abstraction.
 */

interface Pending {
  resolve: (v: any) => void
  reject: (e: Error) => void
}

export type CdpEventHandler = (params: any, sessionId?: string) => void

export class CdpClient {
  private ws!: WebSocket
  private nextId = 1
  private pending = new Map<number, Pending>()
  private handlers = new Map<string, Set<CdpEventHandler>>()

  static async connect(browserWsUrl: string, timeoutMs = 30_000): Promise<CdpClient> {
    const c = new CdpClient()
    await c.open(browserWsUrl, timeoutMs)
    return c
  }

  private open(url: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP ws connect timeout (${timeoutMs}ms)`)), timeoutMs)
      this.ws = new WebSocket(url)
      this.ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      this.ws.onerror = (e: any) => {
        clearTimeout(timer)
        reject(new Error(`CDP ws error: ${e?.message ?? e}`))
      }
      this.ws.onmessage = (ev: MessageEvent) => this.onMessage(String(ev.data))
    })
  }

  private onMessage(data: string) {
    let msg: any
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (msg.id != null) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`))
      else p.resolve(msg.result)
      return
    }
    if (msg.method) {
      const hs = this.handlers.get(msg.method)
      if (hs) for (const h of hs) h(msg.params, msg.sessionId)
    }
  }

  /** Send a CDP command, optionally scoped to a page session. Resolves with the result object. */
  send(method: string, params: Record<string, any> = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++
    const payload: Record<string, any> = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(payload))
    })
  }

  on(method: string, handler: CdpEventHandler): void {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set())
    this.handlers.get(method)!.add(handler)
  }

  off(method: string, handler: CdpEventHandler): void {
    this.handlers.get(method)?.delete(handler)
  }

  close(): void {
    try {
      this.ws.close()
    } catch {
      // already closing
    }
  }
}

/** Convenience: evaluate an expression in a page session and return its value (returnByValue). */
export async function evaluate<T = any>(cdp: CdpClient, sessionId: string, expression: string): Promise<T> {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  )
  if (res.exceptionDetails) {
    throw new Error(`evaluate failed: ${res.exceptionDetails.text ?? 'unknown'} — ${expression.slice(0, 80)}`)
  }
  return res.result?.value as T
}
