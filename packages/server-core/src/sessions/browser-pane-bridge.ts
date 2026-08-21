// input: BrowserPaneManager instance and the ManagedSession being wired
// output: wireBrowserPaneTools — merges BrowserPaneFns into session-scoped tool callbacks
// pos: Agent runtime wiring leaf; owns every browser_* tool delegation rule

import type { IBrowserPaneManager } from '@craft-agent/server-core/handlers'
import type { BrowserPaneFns } from '@craft-agent/shared/agent'
import { mergeSessionScopedToolCallbacks } from '@craft-agent/shared/agent'
import type { ManagedSession } from './managed-session'
import { getSessionLog } from './session-runtime'

/**
 * Wire up browser pane tools — merge BrowserPaneFns into session callbacks
 * so browser_* tools can delegate to BrowserPaneManager.
 */
export function wireBrowserPaneTools(
  browserPaneManager: IBrowserPaneManager | null,
  managed: ManagedSession,
): void {
  if (!browserPaneManager) return
  const bpm = browserPaneManager
  const sid = managed.id

  const resolveSessionBrowserInstance = (toolName: string, options?: { show?: boolean }): string => {
    const instanceId = bpm.createForSession(sid, { show: options?.show ?? false })
    const info = bpm.getInstance(instanceId)
    getSessionLog().info(`[browser-pane] tool target resolved: ${toolName} session=${sid} instance=${instanceId} ownerType=${info?.ownerType ?? 'unknown'} ownerSessionId=${info?.ownerSessionId ?? 'none'} visible=${info?.isVisible ?? false}`)
    return instanceId
  }

  const resolveLifecycleWindowTarget = (command: 'release' | 'close' | 'hide', requestedInstanceId?: string) => {
    const windows = bpm.listInstances()

    if (windows.length === 0) {
      return { windows, reason: 'No browser windows are available. Use "open" first.' }
    }

    const validateTarget = (target: (typeof windows)[number] | undefined) => {
      if (!target) {
        return { ok: false as const, reason: `Browser window "${requestedInstanceId}" not found. Use "windows" to list available windows.` }
      }

      if (target.boundSessionId && target.boundSessionId !== sid) {
        return { ok: false as const, reason: `Browser window "${target.id}" is locked to session ${target.boundSessionId}.` }
      }

      if (!target.boundSessionId && target.ownerSessionId && target.ownerSessionId !== sid) {
        return { ok: false as const, reason: `Browser window "${target.id}" is currently owned by session ${target.ownerSessionId}.` }
      }

      return { ok: true as const, target }
    }

    if (requestedInstanceId) {
      const validated = validateTarget(windows.find((w) => w.id === requestedInstanceId))
      if (!validated.ok) {
        return { windows, reason: validated.reason }
      }
      return { windows, target: validated.target }
    }

    const fallbackTarget = windows.find((w) => w.boundSessionId === sid)
      ?? windows.find((w) => w.ownerSessionId === sid)

    if (!fallbackTarget) {
      return { windows, reason: `No ${command} target is currently associated with this session. Use "windows", then "${command} <id>".` }
    }

    const validated = validateTarget(fallbackTarget)
    if (!validated.ok) {
      return { windows, reason: validated.reason }
    }

    return { windows, target: validated.target }
  }

  mergeSessionScopedToolCallbacks(sid, {
    browserPaneFns: {
      openPanel: async (options) => {
        const instanceId = options?.background
          ? bpm.createForSession(sid, { show: false })
          : bpm.focusBoundForSession(sid)
        const info = bpm.getInstance(instanceId)
        getSessionLog().info(`[browser-pane] route decision: browser_open session=${sid} instance=${instanceId} background=${options?.background ?? false} ownerType=${info?.ownerType ?? 'unknown'} ownerSessionId=${info?.ownerSessionId ?? 'none'} visible=${info?.isVisible ?? false}`)
        return { instanceId }
      },
      navigate: (url) => {
        const instanceId = resolveSessionBrowserInstance('browser_navigate')
        return bpm.navigate(instanceId, url)
      },
      snapshot: () => {
        const instanceId = resolveSessionBrowserInstance('browser_snapshot')
        return bpm.getAccessibilitySnapshot(instanceId)
      },
      click: (ref, options) => {
        const instanceId = resolveSessionBrowserInstance('browser_click')
        return bpm.clickElement(instanceId, ref, options)
      },
      clickAt: (x, y) => {
        const instanceId = resolveSessionBrowserInstance('browser_click_at')
        return bpm.clickAtCoordinates(instanceId, x, y)
      },
      drag: (x1, y1, x2, y2) => {
        const instanceId = resolveSessionBrowserInstance('browser_drag')
        return bpm.drag(instanceId, x1, y1, x2, y2)
      },
      fill: (ref, value) => {
        const instanceId = resolveSessionBrowserInstance('browser_fill')
        return bpm.fillElement(instanceId, ref, value)
      },
      type: (text) => {
        const instanceId = resolveSessionBrowserInstance('browser_type')
        return bpm.typeText(instanceId, text)
      },
      select: (ref, value) => {
        const instanceId = resolveSessionBrowserInstance('browser_select')
        return bpm.selectOption(instanceId, ref, value)
      },
      setClipboard: (text) => {
        const instanceId = resolveSessionBrowserInstance('browser_set_clipboard')
        return bpm.setClipboard(instanceId, text)
      },
      getClipboard: () => {
        const instanceId = resolveSessionBrowserInstance('browser_get_clipboard')
        return bpm.getClipboard(instanceId)
      },
      screenshot: (options) => {
        const instanceId = resolveSessionBrowserInstance('browser_screenshot')
        return bpm.screenshot(instanceId, options)
      },
      screenshotRegion: (options) => {
        const instanceId = resolveSessionBrowserInstance('browser_screenshot_region')
        return bpm.screenshotRegion(instanceId, options)
      },
      getConsoleLogs: (options) => {
        const instanceId = resolveSessionBrowserInstance('browser_console')
        return Promise.resolve(bpm.getConsoleLogs(instanceId, options))
      },
      windowResize: (options) => {
        const instanceId = resolveSessionBrowserInstance('browser_window_resize')
        return Promise.resolve(bpm.windowResize(instanceId, options.width, options.height))
      },
      getNetworkLogs: (options) => {
        const instanceId = resolveSessionBrowserInstance('browser_network')
        return Promise.resolve(bpm.getNetworkLogs(instanceId, options))
      },
      waitFor: (options) => {
        const instanceId = resolveSessionBrowserInstance('browser_wait')
        return bpm.waitFor(instanceId, options)
      },
      sendKey: (options) => {
        const instanceId = resolveSessionBrowserInstance('browser_key')
        return bpm.sendKey(instanceId, options)
      },
      getDownloads: (options) => {
        const instanceId = resolveSessionBrowserInstance('browser_downloads')
        return bpm.getDownloads(instanceId, options)
      },
      upload: (ref, filePaths) => {
        const instanceId = resolveSessionBrowserInstance('browser_upload')
        return bpm.uploadFile(instanceId, ref, filePaths).then(() => {})
      },
      scroll: (direction, amount) => {
        const instanceId = resolveSessionBrowserInstance('browser_scroll')
        return bpm.scroll(instanceId, direction, amount)
      },
      goBack: () => {
        const instanceId = resolveSessionBrowserInstance('browser_back')
        return bpm.goBack(instanceId)
      },
      goForward: () => {
        const instanceId = resolveSessionBrowserInstance('browser_forward')
        return bpm.goForward(instanceId)
      },
      evaluate: (expression) => {
        const instanceId = resolveSessionBrowserInstance('browser_evaluate')
        return bpm.evaluate(instanceId, expression)
      },
      focusWindow: async (targetInstanceId) => {
        const windows = bpm.listInstances()
        if (windows.length === 0) {
          throw new Error('No browser windows available to focus. Use "open" first.')
        }

        const target = targetInstanceId
          ? windows.find(w => w.id === targetInstanceId)
          : windows.find(w => w.boundSessionId === sid || w.ownerSessionId === sid)

        if (!target) {
          if (targetInstanceId) {
            throw new Error(`Browser window "${targetInstanceId}" not found. Use "windows" to list available windows.`)
          }
          throw new Error('No browser window is currently bound to this session. Use "open --foreground" to create or reuse one.')
        }

        const availableToSession = !target.boundSessionId || target.boundSessionId === sid
        if (!availableToSession) {
          throw new Error(`Browser window "${target.id}" is locked to session ${target.boundSessionId}.`)
        }

        if (!target.boundSessionId) {
          bpm.bindSession(target.id, sid)
        }

        bpm.focus(target.id)
        const focused = bpm.getInstance(target.id)
        return {
          instanceId: target.id,
          title: focused?.title ?? target.title,
          url: focused?.currentUrl ?? target.url,
        }
      },
      releaseControl: async (requestedInstanceId) => {
        if (requestedInstanceId === 'all') {
          const before = bpm.listInstances()
          const beforeActive = before.filter((w) => !!w.agentControlActive).length
          bpm.clearAgentControl(sid)
          const after = bpm.listInstances()
          const afterActive = after.filter((w) => !!w.agentControlActive).length
          const released = afterActive < beforeActive

          getSessionLog().info(`[browser-pane] lifecycle release-all session=${sid} overlays=${beforeActive}->${afterActive}`)

          return {
            action: released ? 'released' : 'noop',
            requestedInstanceId,
            affectedIds: released ? before.filter((w) => !!w.agentControlActive).map((w) => w.id) : [],
            reason: released ? undefined : 'No active overlay was found for this session.',
          }
        }

        const resolution = resolveLifecycleWindowTarget('release', requestedInstanceId)
        if (!resolution.target) {
          getSessionLog().info(`[browser-pane] lifecycle release session=${sid} requested=${requestedInstanceId ?? 'auto'} result=noop reason=${resolution.reason}`)
          return {
            action: 'noop',
            requestedInstanceId,
            affectedIds: [],
            reason: resolution.reason,
          }
        }

        const result = bpm.clearAgentControlForInstance(resolution.target.id, sid)
        const action = result.released ? 'released' : 'noop'
        getSessionLog().info(`[browser-pane] lifecycle release session=${sid} requested=${requestedInstanceId ?? 'auto'} resolved=${resolution.target.id} result=${action} reason=${result.reason ?? 'none'}`)

        return {
          action,
          requestedInstanceId,
          resolvedInstanceId: resolution.target.id,
          affectedIds: result.released ? [resolution.target.id] : [],
          reason: result.reason,
        }
      },
      closeWindow: async (requestedInstanceId) => {
        const resolution = resolveLifecycleWindowTarget('close', requestedInstanceId)
        if (!resolution.target) {
          getSessionLog().info(`[browser-pane] lifecycle close session=${sid} requested=${requestedInstanceId ?? 'auto'} result=noop reason=${resolution.reason}`)
          return {
            action: 'noop',
            requestedInstanceId,
            affectedIds: [],
            reason: resolution.reason,
          }
        }

        bpm.destroyInstance(resolution.target.id)
        getSessionLog().info(`[browser-pane] lifecycle close session=${sid} requested=${requestedInstanceId ?? 'auto'} resolved=${resolution.target.id} result=closed`)

        return {
          action: 'closed',
          requestedInstanceId,
          resolvedInstanceId: resolution.target.id,
          affectedIds: [resolution.target.id],
        }
      },
      hideWindow: async (requestedInstanceId) => {
        const resolution = resolveLifecycleWindowTarget('hide', requestedInstanceId)
        if (!resolution.target) {
          getSessionLog().info(`[browser-pane] lifecycle hide session=${sid} requested=${requestedInstanceId ?? 'auto'} result=noop reason=${resolution.reason}`)
          return {
            action: 'noop',
            requestedInstanceId,
            affectedIds: [],
            reason: resolution.reason,
          }
        }

        bpm.hide(resolution.target.id)
        getSessionLog().info(`[browser-pane] lifecycle hide session=${sid} requested=${requestedInstanceId ?? 'auto'} resolved=${resolution.target.id} result=hidden`)

        return {
          action: 'hidden',
          requestedInstanceId,
          resolvedInstanceId: resolution.target.id,
          affectedIds: [resolution.target.id],
        }
      },
      listWindows: async () => {
        return bpm.listInstances()
      },
      detectChallenge: async () => {
        const instanceId = resolveSessionBrowserInstance('browser_detect_challenge')
        return bpm.detectSecurityChallenge(instanceId)
      },
    } satisfies BrowserPaneFns,
  })
}
