import { describe, expect, it } from 'bun:test'
import { classifyMainWindowNavigation } from '../main-window-navigation'

const PROD_ENTRY = 'file:///Applications/Storyflow.app/Contents/Resources/app/dist/renderer/index.html'
const DEV_ENTRY = 'http://localhost:5173'

describe('classifyMainWindowNavigation', () => {
  it('allows the packaged renderer entry regardless of query and hash', () => {
    expect(classifyMainWindowNavigation(PROD_ENTRY, PROD_ENTRY)).toBe('allow')
    expect(classifyMainWindowNavigation(`${PROD_ENTRY}?workspaceId=ws-1`, PROD_ENTRY)).toBe('allow')
    expect(classifyMainWindowNavigation(`${PROD_ENTRY}?workspaceId=ws-1#/sessions/abc`, PROD_ENTRY)).toBe('allow')
  })

  it('blocks other local files without handing them to the OS', () => {
    expect(classifyMainWindowNavigation('file:///Users/me/Downloads/evil.html', PROD_ENTRY)).toBe('block')
    expect(classifyMainWindowNavigation(
      'file:///Applications/Storyflow.app/Contents/Resources/app/dist/renderer/browser-toolbar.html',
      PROD_ENTRY,
    )).toBe('block')
    expect(classifyMainWindowNavigation(`${PROD_ENTRY}/../../../../evil.html`, PROD_ENTRY)).toBe('block')
  })

  it('allows the dev server entry but not other dev server paths or local files', () => {
    expect(classifyMainWindowNavigation(`${DEV_ENTRY}/?workspaceId=ws-1#/settings`, DEV_ENTRY)).toBe('allow')
    expect(classifyMainWindowNavigation(`${DEV_ENTRY}/browser-toolbar.html`, DEV_ENTRY)).toBe('block')
    expect(classifyMainWindowNavigation('http://localhost:5174/', DEV_ENTRY)).toBe('external')
    expect(classifyMainWindowNavigation('file:///tmp/evil.html', DEV_ENTRY)).toBe('block')
  })

  it('opens web links externally and blocks unparseable URLs', () => {
    expect(classifyMainWindowNavigation('https://example.com/docs', PROD_ENTRY)).toBe('external')
    expect(classifyMainWindowNavigation('not a url', PROD_ENTRY)).toBe('block')
  })

  it('never hands script or data schemes to the OS', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:msgbox', 'blob:https://x/1']) {
      expect(classifyMainWindowNavigation(url, PROD_ENTRY)).toBe('block')
    }
  })

  it('fails closed when the entry URL is malformed', () => {
    expect(classifyMainWindowNavigation('file:///tmp/evil.html', 'localhost:5173')).toBe('block')
    expect(classifyMainWindowNavigation('https://example.com', 'not a url')).toBe('block')
  })
})
