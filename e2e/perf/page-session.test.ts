import { expect, test } from 'bun:test'
import type { CdpEventHandler } from './cdp'
import { openAttachedPage } from './page-session'

function fakeCdp() {
  const handlers = new Map<string, Set<CdpEventHandler>>()
  const emit = (targetId: string, sessionId: string) => {
    for (const handler of handlers.get('Target.attachedToTarget') ?? []) handler({ targetInfo: { type: 'page', targetId }, sessionId })
  }
  let queries = 0
  let opened = false
  const cdp = {
    on: (event: string, handler: CdpEventHandler) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(handler) },
    off: (event: string, handler: CdpEventHandler) => { handlers.get(event)?.delete(handler) },
    send: async () => {
      queries++
      if (opened && queries === 2) emit('primary', 'unrelated-session')
      if (opened && queries >= 4) emit('new-page', 'new-session')
      return { targetInfos: [{ type: 'page', targetId: 'primary' }, ...(opened && queries >= 3 ? [{ type: 'page', targetId: 'new-page' }] : [])] }
    },
  }
  return { cdp, emit, handlers, opened: () => { opened = true }, queries: () => queries }
}
test('waits for page discovery and that exact target attach, regardless of the latest attached session', async () => {
  const fake = fakeCdp()
  const result = await openAttachedPage(fake.cdp, async () => { fake.opened() })
  expect(result).toEqual({ targetId: 'new-page', sid: 'new-session' })
  expect(fake.queries()).toBe(4)
  expect([...fake.handlers.values()].every(set => set.size === 0)).toBe(true)
})
test('keeps an attach that arrives before the open RPC returns and before discovery', async () => {
  const fake = fakeCdp()
  const result = await openAttachedPage(fake.cdp, async () => { fake.opened(); fake.emit('new-page', 'early-session') })
  expect(result).toEqual({ targetId: 'new-page', sid: 'early-session' })
  expect(fake.queries()).toBe(3)
})
test('removes listeners if window creation fails', async () => {
  const fake = fakeCdp()
  await expect(openAttachedPage(fake.cdp, async () => { throw new Error('open failed') })).rejects.toThrow('open failed')
  expect([...fake.handlers.values()].every(set => set.size === 0)).toBe(true)
})
