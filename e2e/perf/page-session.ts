// input: CDP auto-attach events and an action opening one new page
// output: The new page's own target ID and attached renderer session ID
// pos: Keeps multi-window QA independent of launchApp's last-attached sid
import type { CdpClient } from './cdp'

type PageCdp = Pick<CdpClient, 'send' | 'on' | 'off'>

export async function openAttachedPage(cdp: PageCdp, open: () => Promise<unknown>, timeoutMs = 30_000) {
  const sessions = new Map<string, string>()
  const attached = (event: any) => {
    if (event.targetInfo?.type === 'page') sessions.set(event.targetInfo.targetId, event.sessionId)
  }
  const detached = (event: any) => {
    for (const [target, session] of sessions) if (session === event.sessionId) sessions.delete(target)
  }
  // Subscribe before opening: target creation and auto-attach are independent,
  // and either can arrive before the open RPC acknowledges completion.
  cdp.on('Target.attachedToTarget', attached)
  cdp.on('Target.detachedFromTarget', detached)
  try {
    const initial = await cdp.send('Target.getTargets')
    const known = new Set(initial.targetInfos.filter((target: any) => target.type === 'page').map((target: any) => target.targetId))
    const deadline = Date.now() + timeoutMs
    await open()
    while (Date.now() < deadline) {
      const targets = await cdp.send('Target.getTargets')
      const pages = targets.targetInfos.filter((target: any) => target.type === 'page' && !known.has(target.targetId))
      if (pages.length > 1) throw new Error('Expected exactly one new page')
      if (pages.length === 1) {
        const targetId: string = pages[0].targetId
        const sid = sessions.get(targetId)
        if (sid) return { targetId, sid }
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('Timed out waiting for the new page and its renderer session attach')
  } finally {
    cdp.off('Target.attachedToTarget', attached)
    cdp.off('Target.detachedFromTarget', detached)
  }
}
