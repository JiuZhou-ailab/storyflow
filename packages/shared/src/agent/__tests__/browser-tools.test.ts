/**
 * Tests for the runtime-neutral browser command executor.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import type { BrowserPaneFns } from '../browser-tools'
import {
  executeBrowserToolCommand,
  type BrowserCommandResult,
} from '../browser-tool-runtime'

// ============================================================================
// Mock BrowserPaneFns
// ============================================================================

function createMockFns(): BrowserPaneFns {
  return {
    openPanel: async () => ({ instanceId: 'browser-test-1' }),
    navigate: async (url: string) => ({ url: `https://${url}`, title: 'Test Page' }),
    snapshot: async () => ({
      url: 'https://example.com',
      title: 'Example',
      nodes: [
        { ref: '@e1', role: 'button', name: 'Click me' },
        { ref: '@e2', role: 'textbox', name: 'Search', value: '', focused: true },
      ],
    }),
    click: async (_ref: string) => {},
    clickAt: async (_x: number, _y: number) => {},
    drag: async (_x1: number, _y1: number, _x2: number, _y2: number) => {},
    fill: async (_ref: string, _value: string) => {},
    type: async (_text: string) => {},
    select: async (_ref: string, _value: string) => {},
    setClipboard: async (_text: string) => {},
    getClipboard: async () => 'clipboard content',
    screenshot: async () => ({ imageBuffer: Buffer.from('fake-png-data'), imageFormat: 'png' as const }),
    screenshotRegion: async () => ({ imageBuffer: Buffer.from('fake-png-data'), imageFormat: 'png' as const }),
    getConsoleLogs: async () => ([
      { timestamp: Date.now(), level: 'warn', message: 'Test warning' },
    ]),
    windowResize: async (args) => ({ width: args.width, height: args.height }),
    getNetworkLogs: async () => ([
      { timestamp: Date.now(), method: 'GET', url: 'https://example.com/api', status: 500, resourceType: 'xhr', ok: false },
    ]),
    waitFor: async (args) => ({ ok: true as const, kind: args.kind, elapsedMs: 123, detail: 'condition met' }),
    sendKey: async (_args) => {},
    getDownloads: async () => ([
      { id: 'dl-1', timestamp: Date.now(), url: 'https://example.com/file.pdf', filename: 'file.pdf', state: 'completed', bytesReceived: 100, totalBytes: 100, mimeType: 'application/pdf' },
    ]),
    upload: async (_ref: string, _filePaths: string[]) => {},
    scroll: async (_dir: 'up' | 'down' | 'left' | 'right', _amount?: number) => {},
    goBack: async () => {},
    goForward: async () => {},
    evaluate: async (expr: string) => eval(expr),
    focusWindow: async (instanceId?: string) => ({ instanceId: instanceId ?? 'browser-1', title: 'Example Domain', url: 'https://example.com' }),
    releaseControl: async (_instanceId?: string) => ({ action: 'released' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }),
    closeWindow: async (_instanceId?: string) => ({ action: 'closed' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }),
    hideWindow: async (_instanceId?: string) => ({ action: 'hidden' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }),
    listWindows: async () => ([
      {
        id: 'browser-1',
        title: 'Example Domain',
        url: 'https://example.com',
        isVisible: true,
        ownerType: 'session',
        ownerSessionId: 'test-session',
        boundSessionId: 'test-session',
        agentControlActive: true,
      },
    ]),
    detectChallenge: async () => ({ detected: false, provider: 'none', signals: [] }),
  }
}

// ============================================================================
// Helper: execute a runtime command
// ============================================================================

async function executeTool(
  fns: BrowserPaneFns,
  args: { command?: string | string[] } = {},
): Promise<BrowserCommandResult & { isError?: boolean }> {
  try {
    return await executeBrowserToolCommand({
      command: args.command ?? '',
      fns,
      sessionId: 'test-session',
    })
  } catch (error) {
    return {
      output: error instanceof Error ? error.message : String(error),
      appendReleaseHint: false,
      isError: true,
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('executeBrowserToolCommand', () => {
  let mockFns: BrowserPaneFns

  beforeEach(() => {
    mockFns = createMockFns()
  })

  describe('browser_tool', () => {
    it('returns help text for --help without release hint', async () => {
      const result = await executeTool(mockFns, { command: '--help' })
      expect(result.output).toContain('browser_tool command help')
      expect(result.output).toContain('navigate <url>')
      expect(result.output).toContain('find <query>')
      expect(result.output).toContain('click-at <x> <y>')
      expect(result.output).toContain('type <text>')
      expect(result.output).toContain('upload <ref> <path> [path2...]')
      expect(result.output).toContain('set-clipboard <text>')
      expect(result.output).toContain('get-clipboard')
      expect(result.output).toContain('paste <text>')
      expect(result.output).toContain('screenshot [--annotated|-a]')
      expect(result.output).toContain('focus [windowId]')
      expect(result.output).toContain('windows')
      expect(result.output).toContain('Array mode (JSON array input, no batch splitting/tokenization):')
      expect(result.appendReleaseHint).toBe(false)
    })

    it('routes navigate command and appends release hint', async () => {
      const result = await executeTool(mockFns, { command: 'navigate example.com' })
      expect(result.output).toContain('Navigated to')
      expect(result.appendReleaseHint).toBe(true)
    })

    it('releases control when navigate lands on a security challenge', async () => {
      let releaseCalls = 0
      mockFns.detectChallenge = async () => ({
        detected: true,
        provider: 'cloudflare',
        signals: ['title:just-a-moment'],
      })
      mockFns.releaseControl = async (_instanceId?: string) => {
        releaseCalls += 1
        return { action: 'released' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }
      }

      const result = await executeTool(mockFns, { command: 'navigate example.com' })
      expect(releaseCalls).toBe(1)
      expect(result.output).toContain('Security verification detected (cloudflare).')
      expect(result.appendReleaseHint).toBe(false)
    })

    it('routes open command in background by default', async () => {
      let openOptions: { background?: boolean } | undefined
      mockFns.openPanel = async (options) => {
        openOptions = options
        return { instanceId: 'browser-test-1' }
      }

      const result = await executeTool(mockFns, { command: 'open' })
      expect(openOptions).toEqual({ background: true })
      expect(result.output).toContain('Opened in-app browser window in background')
      expect(result.output).toContain('browser-test-1')
    })

    it('routes open command with --foreground flag and reports settled visibility', async () => {
      let openOptions: { background?: boolean } | undefined
      let listCalls = 0
      mockFns.openPanel = async (options) => {
        openOptions = options
        return { instanceId: 'browser-test-1' }
      }
      mockFns.listWindows = async () => {
        listCalls += 1
        const isVisible = listCalls >= 3
        return [{
          id: 'browser-test-1',
          title: 'Example Domain',
          url: 'https://example.com',
          isVisible,
          ownerType: 'session',
          ownerSessionId: 'test-session',
          boundSessionId: 'test-session',
          agentControlActive: true,
        }]
      }

      const result = await executeTool(mockFns, { command: 'open --foreground' })
      expect(openOptions).toEqual({ background: false })
      expect(result.output).toContain('Opened in-app browser window in foreground')
      expect(result.output).toContain('Visibility settle: wait-loop')
      expect(result.output).toContain('Visible: true')
    })

    it('uses focus fallback when foreground open visibility does not settle in wait loop', async () => {
      const previousTimeout = process.env.CRAFT_BROWSER_OPEN_SETTLE_TIMEOUT_MS
      const previousPoll = process.env.CRAFT_BROWSER_OPEN_SETTLE_POLL_MS
      process.env.CRAFT_BROWSER_OPEN_SETTLE_TIMEOUT_MS = '120'
      process.env.CRAFT_BROWSER_OPEN_SETTLE_POLL_MS = '20'

      try {
        let focusCalls = 0
        let listCalls = 0
        mockFns.listWindows = async () => {
          listCalls += 1
          const isVisible = focusCalls > 0
          return [{
            id: 'browser-test-1',
            title: 'Example Domain',
            url: 'https://example.com',
            isVisible,
            ownerType: 'session',
            ownerSessionId: 'test-session',
            boundSessionId: 'test-session',
            agentControlActive: true,
          }]
        }
        mockFns.focusWindow = async (instanceId?: string) => {
          focusCalls += 1
          return {
            instanceId: instanceId ?? 'browser-test-1',
            title: 'Example Domain',
            url: 'https://example.com',
          }
        }

        const result = await executeTool(mockFns, { command: 'open --foreground' })
        expect(listCalls).toBeGreaterThan(2)
        expect(focusCalls).toBe(1)
        expect(result.output).toContain('Visibility settle: timeout + focus retry')
        expect(result.output).toContain('Visible: true')
      } finally {
        if (previousTimeout === undefined) delete process.env.CRAFT_BROWSER_OPEN_SETTLE_TIMEOUT_MS
        else process.env.CRAFT_BROWSER_OPEN_SETTLE_TIMEOUT_MS = previousTimeout

        if (previousPoll === undefined) delete process.env.CRAFT_BROWSER_OPEN_SETTLE_POLL_MS
        else process.env.CRAFT_BROWSER_OPEN_SETTLE_POLL_MS = previousPoll
      }
    })

    it('does not use focus fallback for background open', async () => {
      let focusCalls = 0
      mockFns.focusWindow = async (instanceId?: string) => {
        focusCalls += 1
        return {
          instanceId: instanceId ?? 'browser-test-1',
          title: 'Example Domain',
          url: 'https://example.com',
        }
      }

      const result = await executeTool(mockFns, { command: 'open' })
      expect(focusCalls).toBe(0)
      expect(result.output).not.toContain('Visibility settle:')
    })

    it('routes snapshot command and formats nodes', async () => {
      const result = await executeTool(mockFns, { command: 'snapshot' })
      const text = result.output
      expect(text).toContain('@e1')
      expect(text).toContain('[button]')
      expect(text).toContain('"Click me"')
      expect(text).toContain('(focused)')
    })

    it('treats near-zero actionable snapshot as challenge state and attaches screenshot', async () => {
      let releaseCalls = 0
      mockFns.snapshot = async () => ({
        url: 'https://protected.example.com',
        title: 'Protected',
        nodes: [
          { ref: '@e1', role: 'staticText', name: 'Checking your browser before accessing' },
        ],
      })
      mockFns.detectChallenge = async () => ({
        detected: true,
        provider: 'cloudflare',
        signals: ['text:checking-browser'],
      })
      mockFns.releaseControl = async (_instanceId?: string) => {
        releaseCalls += 1
        return { action: 'released' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }
      }

      const result = await executeTool(mockFns, { command: 'snapshot' })
      expect(releaseCalls).toBe(1)
      expect(result.output).toContain('Security verification detected (cloudflare).')
      expect(result.output).toContain('Detected only 0 actionable element(s) out of 1 accessibility nodes.')
      expect(result.image).toBeDefined()
      expect(result.image?.mimeType).toBe('image/jpeg')
      expect(result.appendReleaseHint).toBe(false)
    })

    it('still reports challenge when screenshot capture fails or is empty', async () => {
      mockFns.snapshot = async () => ({
        url: 'https://protected.example.com',
        title: 'Protected',
        nodes: [],
      })
      mockFns.detectChallenge = async () => ({
        detected: true,
        provider: 'cloudflare',
        signals: ['title:just-a-moment'],
      })
      mockFns.screenshot = async () => ({ imageBuffer: Buffer.alloc(0), imageFormat: 'png' as const })

      const result = await executeTool(mockFns, { command: 'snapshot' })
      expect(result.output).toContain('Security verification detected (cloudflare).')
      expect(result.output).toContain('Detected only 0 actionable element(s) out of 0 accessibility nodes.')
      expect(Boolean(result.image)).toBe(false)
      expect(result.appendReleaseHint).toBe(false)
    })

    it('routes find command and returns matching refs', async () => {
      const result = await executeTool(mockFns, { command: 'find click button' })
      const text = result.output
      expect(text).toContain('Found 1 element(s)')
      expect(text).toContain('@e1')
      expect(text).toContain('[button]')
    })

    it('returns helpful message for find command with no matches', async () => {
      const result = await executeTool(mockFns, { command: 'find this-does-not-exist' })
      expect(result.output).toContain('No elements found matching')
    })

    it('routes click command', async () => {
      let clickedRef = ''
      mockFns.click = async (ref) => { clickedRef = ref }
      const result = await executeTool(mockFns, { command: 'click @e1' })
      expect(clickedRef).toBe('@e1')
      expect(result.output).toContain('Clicked element @e1')
    })

    it('routes click with wait arguments', async () => {
      const result = await executeTool(mockFns, { command: 'click @e1 network-idle 5000' })
      expect(result.output).toContain('waitFor=network-idle')
    })

    it('detects security challenge after click even when URL does not change', async () => {
      let releaseCalls = 0
      mockFns.detectChallenge = async () => ({
        detected: true,
        provider: 'cloudflare',
        signals: ['dom:challenge-form'],
      })
      mockFns.releaseControl = async (_instanceId?: string) => {
        releaseCalls += 1
        return { action: 'released' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }
      }

      const result = await executeTool(mockFns, { command: 'click @e1' })
      expect(releaseCalls).toBe(1)
      expect(result.output).toContain('security challenge detected (cloudflare)')
      expect(result.output).toContain('URL changed: false')
      expect(result.appendReleaseHint).toBe(false)
    })

    it('routes click-at command with coordinates', async () => {
      let clickedX = 0
      let clickedY = 0
      mockFns.clickAt = async (x, y) => { clickedX = x; clickedY = y }
      const result = await executeTool(mockFns, { command: 'click-at 350 200' })
      expect(clickedX).toBe(350)
      expect(clickedY).toBe(200)
      expect(result.output).toContain('Clicked at coordinates (350, 200)')
    })

    it('returns error for click-at with missing coordinates', async () => {
      const result = await executeTool(mockFns, { command: 'click-at 350' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('click-at requires x and y coordinates')
    })

    it('returns error for click-at with non-numeric coordinates', async () => {
      const result = await executeTool(mockFns, { command: 'click-at foo bar' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('click-at coordinates must be numbers')
    })

    it('routes drag command with coordinates', async () => {
      let draggedCoords = { x1: 0, y1: 0, x2: 0, y2: 0 }
      mockFns.drag = async (x1, y1, x2, y2) => { draggedCoords = { x1, y1, x2, y2 } }
      const result = await executeTool(mockFns, { command: 'drag 100 200 300 400' })
      expect(draggedCoords).toEqual({ x1: 100, y1: 200, x2: 300, y2: 400 })
      expect(result.output).toContain('Dragged from (100, 200) to (300, 400)')
    })

    it('returns error for drag with missing coordinates', async () => {
      const result = await executeTool(mockFns, { command: 'drag 100 200' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('drag requires 4 coordinates')
    })

    it('returns error for drag with non-numeric coordinates', async () => {
      const result = await executeTool(mockFns, { command: 'drag foo bar baz qux' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('drag coordinates must be numbers')
    })

    it('routes fill command', async () => {
      let filledRef = ''
      let filledValue = ''
      mockFns.fill = async (ref, value) => { filledRef = ref; filledValue = value }
      const result = await executeTool(mockFns, { command: 'fill @e2 hello world' })
      expect(filledRef).toBe('@e2')
      expect(filledValue).toBe('hello world')
      expect(result.output).toContain('Filled element @e2')
    })

    it('supports semicolon command batching', async () => {
      const calls: string[] = []
      mockFns.fill = async (ref, value) => { calls.push(`fill:${ref}:${value}`) }
      mockFns.click = async (ref) => { calls.push(`click:${ref}`) }

      const result = await executeTool(mockFns, {
        command: 'fill @e1 user@example.com; fill @e2 password123; click @e3',
      })

      expect(calls).toEqual([
        'fill:@e1:user@example.com',
        'fill:@e2:password123',
        'click:@e3',
      ])
      expect(result.output).toContain('Filled element @e1')
      expect(result.output).toContain('Clicked element @e3')
    })

    it('does not split batch on semicolons inside quoted text', async () => {
      const calls: string[] = []
      mockFns.fill = async (ref, value) => { calls.push(`fill:${ref}:${value}`) }
      mockFns.click = async (ref) => { calls.push(`click:${ref}`) }

      const result = await executeTool(mockFns, {
        command: 'fill @e1 "a;b;c"; click @e2',
      })

      expect(calls).toEqual([
        'fill:@e1:a;b;c',
        'click:@e2',
      ])
      expect(result.output).toContain('Filled element @e1 with "a;b;c"')
      expect(result.output).toContain('Clicked element @e2')
    })

    it('stops batched commands after navigation-changing command', async () => {
      const calls: string[] = []
      mockFns.navigate = async (url) => {
        calls.push(`navigate:${url}`)
        return { url, title: 'Page' }
      }
      mockFns.fill = async (ref, value) => { calls.push(`fill:${ref}:${value}`) }

      const result = await executeTool(mockFns, {
        command: 'fill @e1 start; navigate https://example.com; fill @e2 should-not-run',
      })

      expect(calls).toEqual([
        'fill:@e1:start',
        'navigate:https://example.com',
      ])
      expect(result.output).toContain('stopped batch after "navigate"')
    })

    it('routes type command', async () => {
      let typedText = ''
      mockFns.type = async (text) => { typedText = text }
      const result = await executeTool(mockFns, { command: 'type Hello World' })
      expect(typedText).toBe('Hello World')
      expect(result.output).toContain('Typed 11 characters into focused element')
    })

    it('returns error for type with no text', async () => {
      const result = await executeTool(mockFns, { command: 'type' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('type requires text')
    })

    it('routes select command', async () => {
      let selectedRef = ''
      let selectedValue = ''
      mockFns.select = async (ref, value) => { selectedRef = ref; selectedValue = value }
      mockFns.snapshot = async () => ({
        url: 'https://example.com',
        title: 'Example',
        nodes: [
          { ref: '@e3', role: 'combobox', name: 'Type', value: 'optionValue' },
        ],
      })

      const result = await executeTool(mockFns, { command: 'select @e3 optionValue' })
      expect(selectedRef).toBe('@e3')
      expect(selectedValue).toBe('optionValue')
      expect(result.output).toContain('(verified)')
    })

    it('parses select assertion flags and timeout', async () => {
      let selectedRef = ''
      let selectedValue = ''
      mockFns.select = async (ref, value) => { selectedRef = ref; selectedValue = value }
      mockFns.snapshot = async () => ({
        url: 'https://example.com',
        title: 'Example',
        nodes: [
          { ref: '@e75', role: 'combobox', name: 'Type', value: 'CNAME' },
          { ref: '@e80', role: 'textbox', name: 'Target', value: 'beautiful-mermaid.com' },
        ],
      })

      const result = await executeTool(mockFns, {
        command: 'select @e75 CNAME --assert-text Target --assert-value CNAME --timeout 3000',
      })

      expect(selectedRef).toBe('@e75')
      expect(selectedValue).toBe('CNAME')
      expect(result.output).toContain('assertTextMatched=true')
      expect(result.output).toContain('assertValueMatched=true')
      expect(result.output).toContain('timeout=3000ms')
      expect(result.output).toContain('(verified)')
    })

    it('accepts assert-value from downstream node when selected control metadata lags', async () => {
      let snapshotCount = 0
      mockFns.snapshot = async () => {
        snapshotCount += 1
        if (snapshotCount === 1) {
          return {
            url: 'https://example.com',
            title: 'Example',
            nodes: [
              { ref: '@e75', role: 'combobox', name: 'Sort updated-newest', value: 'Sort' },
              { ref: '@e80', role: 'status', name: 'Current sort', value: 'updated-newest' },
            ],
          }
        }

        return {
          url: 'https://example.com',
          title: 'Example',
          nodes: [
            { ref: '@e75', role: 'combobox', name: 'Sort updated-newest', value: 'Sort' },
            { ref: '@e81', role: 'status', name: 'Current sort', value: 'updated-newest' },
          ],
        }
      }

      const result = await executeTool(mockFns, {
        command: 'select @e75 updated-newest --assert-value updated-newest --timeout 500',
      })

      expect(result.output).toContain('(verified)')
      expect(result.output).toContain('assertValueMatched=true')
      expect(result.output).not.toContain('assert-value did not match')
    })

    it('returns warning when select cannot be verified', async () => {
      mockFns.snapshot = async () => ({
        url: 'https://example.com',
        title: 'Example',
        nodes: [
          { ref: '@e75', role: 'combobox', name: 'Type', value: 'A' },
          { ref: '@e80', role: 'textbox', name: 'IPv4 address (required)', value: '' },
        ],
      })

      const result = await executeTool(mockFns, {
        command: 'select @e75 CNAME --assert-text Target --timeout 500',
      })

      expect(result.output).toContain('(warning)')
      expect(result.output).toContain('Warning: select interaction succeeded but effective form state could not be fully verified')
      expect(result.output).toContain('assert-text did not match: "Target"')
    })

    it('returns error when select assertion flag is missing value', async () => {
      const result = await executeTool(mockFns, {
        command: 'select @e75 CNAME --assert-text',
      })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('select --assert-text requires a value')
    })

    it('routes upload command with one or more file paths', async () => {
      let uploadedRef = ''
      let uploadedPaths: string[] = []
      mockFns.upload = async (ref, filePaths) => { uploadedRef = ref; uploadedPaths = filePaths }

      const result = await executeTool(mockFns, {
        command: 'upload @e3 /tmp/a.pdf /tmp/b.jpg',
      })

      expect(uploadedRef).toBe('@e3')
      expect(uploadedPaths).toEqual(['/tmp/a.pdf', '/tmp/b.jpg'])
      expect(result.output).toContain('Uploaded 2 files:')
      expect(result.output).toContain('/tmp/a.pdf')
      expect(result.output).toContain('/tmp/b.jpg')
    })

    it('returns error for upload with missing arguments', async () => {
      const result = await executeTool(mockFns, { command: 'upload @e3' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('upload requires ref and file path(s)')
    })

    it('routes set-clipboard command', async () => {
      let clipboardText = ''
      mockFns.setClipboard = async (text) => { clipboardText = text }
      const result = await executeTool(mockFns, { command: 'set-clipboard Hello World' })
      expect(clipboardText).toBe('Hello World')
      expect(result.output).toContain('Clipboard set (11 characters)')
    })

    it('decodes escaped tab/newline sequences for set-clipboard', async () => {
      let clipboardText = ''
      mockFns.setClipboard = async (text) => { clipboardText = text }
      const result = await executeTool(mockFns, {
        command: 'set-clipboard Hello\\tWorld\\nFoo\\tBar',
      })
      expect(clipboardText).toBe('Hello\tWorld\nFoo\tBar')
      expect(result.output).toContain('Clipboard set (19 characters)')
    })

    it('preserves unknown escapes for set-clipboard', async () => {
      let clipboardText = ''
      mockFns.setClipboard = async (text) => { clipboardText = text }
      await executeTool(mockFns, {
        command: 'set-clipboard keep\\xliteral',
      })
      expect(clipboardText).toBe('keep\\xliteral')
    })

    it('returns error for set-clipboard with no text', async () => {
      const result = await executeTool(mockFns, { command: 'set-clipboard' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('set-clipboard requires text')
    })

    it('routes get-clipboard command', async () => {
      mockFns.getClipboard = async () => 'some clipboard data'
      const result = await executeTool(mockFns, { command: 'get-clipboard' })
      expect(result.output).toContain('Clipboard content (19 chars, 1 lines, 0 tabs):')
      expect(result.output).toContain('some clipboard data')
      expect(result.appendReleaseHint).toBe(true)
    })

    it('routes get-clipboard returns empty placeholder for empty clipboard', async () => {
      mockFns.getClipboard = async () => ''
      const result = await executeTool(mockFns, { command: 'get-clipboard' })
      expect(result.output).toContain('(empty clipboard)')
    })

    it('routes paste command (set-clipboard + key)', async () => {
      let clipboardText = ''
      let keySent = ''
      mockFns.setClipboard = async (text) => { clipboardText = text }
      mockFns.sendKey = async (args) => { keySent = args.key }
      const result = await executeTool(mockFns, { command: 'paste Hello World' })
      expect(clipboardText).toBe('Hello World')
      expect(keySent).toBe('v')
      expect(result.output).toContain('Pasted 11 characters')
    })

    it('decodes escaped tab/newline sequences for paste', async () => {
      let clipboardText = ''
      let keySent = ''
      mockFns.setClipboard = async (text) => { clipboardText = text }
      mockFns.sendKey = async (args) => { keySent = args.key }
      const result = await executeTool(mockFns, {
        command: 'paste Hello\\tWorld\\nFoo\\tBar',
      })
      expect(clipboardText).toBe('Hello\tWorld\nFoo\tBar')
      expect(keySent).toBe('v')
      expect(result.output).toContain('Pasted 19 characters')
    })

    it('returns error for paste with no text', async () => {
      const result = await executeTool(mockFns, { command: 'paste' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('paste requires text')
    })

    it('routes screenshot command and returns image block', async () => {
      const result = await executeTool(mockFns, { command: 'screenshot' })
      expect(result.output).toContain('Screenshot captured')
      expect(result.image).toBeDefined()
      expect(result.image?.mimeType).toBe('image/png')
    })

    it('routes annotated screenshot and passes annotate flag', async () => {
      let screenshotArgs: any
      mockFns.screenshot = async (args) => {
        screenshotArgs = args
        return { imageBuffer: Buffer.from('fake-png-data'), imageFormat: 'png' as const }
      }

      const result = await executeTool(mockFns, { command: 'screenshot --annotated' })
      expect(screenshotArgs).toMatchObject({ annotate: true, format: 'jpeg' })
      expect(result.output).toContain('Annotated screenshot captured')
      expect(result.image).toBeDefined()
    })

    it('routes screenshot-region command and returns image block', async () => {
      const result = await executeTool(mockFns, { command: 'screenshot-region 10 20 100 80' })
      expect(result.output).toContain('Region screenshot captured')
      expect(result.image).toBeDefined()
      expect(result.image?.mimeType).toBe('image/png')
    })

    it('returns error for screenshot when PNG is empty', async () => {
      mockFns.screenshot = async () => ({ imageBuffer: Buffer.alloc(0), imageFormat: 'png' as const })
      const result = await executeTool(mockFns, { command: 'screenshot' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('empty image data')
    })

    it('returns error for screenshot-region when PNG is empty', async () => {
      mockFns.screenshotRegion = async () => ({ imageBuffer: Buffer.alloc(0), imageFormat: 'png' as const })
      const result = await executeTool(mockFns, { command: 'screenshot-region 10 20 100 80' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('empty image data')
    })

    it('returns parse error for screenshot-region missing padding value', async () => {
      const result = await executeTool(mockFns, { command: 'screenshot-region --ref @e12 --padding' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('Missing value for --padding')
    })

    it('returns parse error for screenshot-region non-numeric coords', async () => {
      const result = await executeTool(mockFns, { command: 'screenshot-region 10 nope 100 80' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('coordinates must be numbers')
    })

    it('treats --padding-like text inside quoted selectors as selector content', async () => {
      let screenshotRegionArgs: any
      mockFns.screenshotRegion = async (args) => {
        screenshotRegionArgs = args
        return { imageBuffer: Buffer.from('fake-png-data'), imageFormat: 'png' as const }
      }

      const result = await executeTool(mockFns, {
        command: 'screenshot-region --selector "div[data-tip=\'--padding 99\';data-x=\'a;b\']" --padding 8',
      })

      expect(result.isError).toBeUndefined()
      expect(screenshotRegionArgs).toMatchObject({
        selector: "div[data-tip='--padding 99';data-x='a;b']",
        padding: 8,
        format: 'jpeg',
      })
      expect(result.output).toContain('Region screenshot captured')
    })

    it('routes console command', async () => {
      const result = await executeTool(mockFns, { command: 'console 10 warn' })
      expect(result.output).toContain('Console entries')
    })

    it('routes window-resize command', async () => {
      const result = await executeTool(mockFns, { command: 'window-resize 1024 768' })
      expect(result.output).toContain('Window resized to 1024x768')
    })

    it('routes network command', async () => {
      const result = await executeTool(mockFns, { command: 'network 10 failed' })
      expect(result.output).toContain('Network entries')
    })

    it('routes wait command', async () => {
      const result = await executeTool(mockFns, { command: 'wait network-idle 5000' })
      expect(result.output).toContain('Wait succeeded')
    })

    it('parses quoted wait text values with spaces', async () => {
      let waitArgs: any
      mockFns.waitFor = async (args) => {
        waitArgs = args
        return { ok: true as const, kind: args.kind, elapsedMs: 42, detail: 'condition met' }
      }

      const result = await executeTool(mockFns, {
        command: 'wait text "hello world" 5000',
      })

      expect(waitArgs).toEqual({ kind: 'text', value: 'hello world', timeoutMs: 5000 })
      expect(result.output).toContain('Wait succeeded')
    })

    it('routes key command', async () => {
      const result = await executeTool(mockFns, { command: 'key Enter' })
      expect(result.output).toContain('Key sent: Enter')
    })

    it('routes downloads command', async () => {
      const result = await executeTool(mockFns, { command: 'downloads list 10' })
      expect(result.output).toContain('Downloads (')
    })

    it('includes savePath in downloads output when available', async () => {
      mockFns.getDownloads = async () => ([
        {
          id: 'dl-42',
          timestamp: Date.now(),
          url: 'https://example.com/file.pdf',
          filename: 'file.pdf',
          state: 'completed',
          bytesReceived: 100,
          totalBytes: 100,
          mimeType: 'application/pdf',
          savePath: '/tmp/downloads/file.pdf',
        },
      ])

      const result = await executeTool(mockFns, { command: 'downloads list 10' })
      expect(result.output).toContain('-> /tmp/downloads/file.pdf')
    })

    it('routes scroll command', async () => {
      const result = await executeTool(mockFns, { command: 'scroll down 800' })
      expect(result.output).toContain('Scrolled down')
    })

    it('routes back command', async () => {
      const result = await executeTool(mockFns, { command: 'back' })
      expect(result.output).toContain('Navigated back')
    })

    it('routes forward command', async () => {
      const result = await executeTool(mockFns, { command: 'forward' })
      expect(result.output).toContain('Navigated forward')
    })

    it('routes evaluate command', async () => {
      mockFns.evaluate = async () => ({ key: 'value' })
      const result = await executeTool(mockFns, { command: 'evaluate 1+1' })
      expect(result.output).toContain('"key"')
    })

    it('preserves quoted evaluate expressions with semicolons', async () => {
      let evaluatedExpression = ''
      mockFns.evaluate = async (expression) => {
        evaluatedExpression = expression
        return 'ok'
      }

      const result = await executeTool(mockFns, {
        command: 'evaluate "document.title + \';\' + location.href"',
      })

      expect(evaluatedExpression).toBe("document.title + ';' + location.href")
      expect(result.output).toContain('ok')
    })

    it('lists browser windows via windows command without release hint', async () => {
      const result = await executeTool(mockFns, { command: 'windows' })
      expect(result.output).toContain('Browser windows (1)')
      expect(result.output).toContain('browser-1')
      expect(result.output).toContain('ownerType: session')
      expect(result.output).toContain('lockState: locked-session(test-session)')
      expect(result.output).toContain('availableToSession: true')
      expect(result.output).toContain('agentControlActive: true')
      expect(result.appendReleaseHint).toBe(false)
    })

    it('routes focus command and calls focusWindow', async () => {
      let focusedId: string | undefined
      mockFns.focusWindow = async (instanceId?: string) => {
        focusedId = instanceId
        return { instanceId: instanceId ?? 'browser-1', title: 'Focused Tab', url: 'https://focused.example' }
      }

      const result = await executeTool(mockFns, { command: 'focus browser-1' })

      expect(focusedId).toBe('browser-1')
      expect(result.output).toContain('Focused browser window browser-1')
      expect(result.appendReleaseHint).toBe(true)
    })

    it('routes release command and calls releaseControl without hint', async () => {
      let requestedId: string | undefined
      mockFns.releaseControl = async (instanceId?: string) => {
        requestedId = instanceId
        return { action: 'released' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }
      }

      const result = await executeTool(mockFns, { command: 'release' })

      expect(requestedId).toBeUndefined()
      expect(result.output).toContain('Browser control released')
      expect(result.appendReleaseHint).toBe(false)
    })

    it('routes close command and calls closeWindow without hint', async () => {
      let requestedId: string | undefined
      mockFns.closeWindow = async (instanceId?: string) => {
        requestedId = instanceId
        return { action: 'closed' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }
      }

      const result = await executeTool(mockFns, { command: 'close' })

      expect(requestedId).toBeUndefined()
      expect(result.output).toContain('Browser window closed and destroyed')
      expect(result.appendReleaseHint).toBe(false)
    })

    it('routes hide command and calls hideWindow without hint', async () => {
      let requestedId: string | undefined
      mockFns.hideWindow = async (instanceId?: string) => {
        requestedId = instanceId
        return { action: 'hidden' as const, resolvedInstanceId: 'browser-1', affectedIds: ['browser-1'] }
      }

      const result = await executeTool(mockFns, { command: 'hide' })

      expect(requestedId).toBeUndefined()
      expect(result.output).toContain('Browser window hidden')
      expect(result.appendReleaseHint).toBe(false)
    })

    it('routes close command with explicit window id', async () => {
      let requestedId: string | undefined
      mockFns.closeWindow = async (instanceId?: string) => {
        requestedId = instanceId
        return { action: 'closed' as const, requestedInstanceId: instanceId, resolvedInstanceId: instanceId, affectedIds: instanceId ? [instanceId] : [] }
      }

      const result = await executeTool(mockFns, { command: 'close browser-9' })

      expect(requestedId).toBe('browser-9')
      expect(result.output).toContain('Browser window closed and destroyed')
      expect(result.output).toContain('requested=browser-9')
    })

    it('reports close no-op explicitly', async () => {
      mockFns.closeWindow = async (instanceId?: string) => ({
        action: 'noop' as const,
        requestedInstanceId: instanceId,
        affectedIds: [],
        reason: 'No close target is currently associated with this session.',
      })

      const result = await executeTool(mockFns, { command: 'close' })

      expect(result.output).toContain('No browser window was closed')
      expect(result.output).toContain('No window state changed')
      expect(result.output).toContain('No close target is currently associated with this session')
    })

    it('returns validation feedback for invalid command', async () => {
      const result = await executeTool(mockFns, { command: 'scroll diagonal' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('scroll requires direction')
    })

    it('returns parse error for unclosed quotes', async () => {
      const result = await executeTool(mockFns, { command: 'fill @e1 "unterminated' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('Parse error: unclosed quote')
    })

    it('returns error for unknown command', async () => {
      const result = await executeTool(mockFns, { command: 'teleport' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('Unknown browser_tool command')
    })
  })

  describe('array command mode', () => {
    it('evaluate preserves semicolons without quoting', async () => {
      let evaluatedExpression = ''
      mockFns.evaluate = async (expression) => {
        evaluatedExpression = expression
        return 'ok'
      }
      const result = await executeTool(mockFns, {
        command: ['evaluate', 'var x = 1; var y = 2; x + y'],
      })
      expect(evaluatedExpression).toBe('var x = 1; var y = 2; x + y')
      expect(result.output).toContain('ok')
    })

    it('paste preserves tabs and newlines', async () => {
      let clipboardText = ''
      mockFns.setClipboard = async (text) => { clipboardText = text }
      mockFns.sendKey = async () => {}
      const result = await executeTool(mockFns, {
        command: ['paste', 'Name\tAge\nAlice\t30'],
      })
      expect(clipboardText).toBe('Name\tAge\nAlice\t30')
      expect(result.output).toContain('Pasted')
    })

    it('set-clipboard preserves semicolons and special characters', async () => {
      let clipboardText = ''
      mockFns.setClipboard = async (text) => { clipboardText = text }
      const result = await executeTool(mockFns, {
        command: ['set-clipboard', 'function foo() { return 1; }'],
      })
      expect(clipboardText).toBe('function foo() { return 1; }')
      expect(result.output).toContain('Clipboard set')
    })

    it('click works with array input', async () => {
      let clickedRef = ''
      mockFns.click = async (ref) => { clickedRef = ref }
      const result = await executeTool(mockFns, {
        command: ['click', '@e1'],
      })
      expect(clickedRef).toBe('@e1')
      expect(result.output).toContain('Clicked element @e1')
    })

    it('empty array returns error', async () => {
      const result = await executeTool(mockFns, {
        command: [],
      })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('Missing command')
    })

    it('type preserves whitespace characters', async () => {
      let typedText = ''
      mockFns.type = async (text) => { typedText = text }
      const result = await executeTool(mockFns, {
        command: ['type', 'Hello\tWorld'],
      })
      expect(typedText).toBe('Hello\tWorld')
      expect(result.output).toContain('Typed')
    })

    it('--help works in array mode', async () => {
      const result = await executeTool(mockFns, {
        command: ['--help'],
      })
      expect(result.output).toContain('browser_tool command help')
    })
  })

  describe('error handling', () => {
    it('catches and wraps thrown errors', async () => {
      mockFns.navigate = async () => { throw new Error('Network error') }
      const result = await executeTool(mockFns, { command: 'navigate test.com' })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('Network error')
    })
  })
})
