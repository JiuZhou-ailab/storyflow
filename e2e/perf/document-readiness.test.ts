import { expect, test } from 'bun:test'
import { writingDocumentReadyExpression } from './navigation'

function ready(input: { label: string; value: string; loading?: boolean; syncedPath?: string } | null, view: 'source' | 'writing' = 'source') {
  return new Function('document', `return ${writingDocumentReadyExpression(200)}`)({
    querySelector: (selector: string) => {
      if (!input) return null
      if (selector.startsWith('textarea')) return view === 'source' ? { value: input.value, getAttribute: () => input.label } : null
      if (view !== 'writing') return null
      return { querySelector: (child: string) => child === 'p[title]'
        ? { getAttribute: () => input.label }
        : {
          getAttribute: (name: string) => name === 'data-document-path' ? input.label : String(input.loading ?? false),
          querySelector: () => ({
            getAttribute: () => input.syncedPath ?? input.label,
            querySelector: () => ({ textContent: input.value }),
          }),
        } }
    },
  })
}

test('chapter readiness requires the requested document content, not a previous editor or loading shell', () => {
  for (const view of ['source', 'writing'] as const) {
    expect(ready(null, view)).toBe(false)
    expect(ready({ label: '/fixture/第199章.md', value: 'previous chapter' }, view)).toBe(false)
    expect(ready({ label: '/fixture/第200章.md', value: '' }, view)).toBe(false)
    expect(ready({ label: '/fixture/第200章.md', value: 'requested chapter' }, view)).toBe(true)
  }
})
test('a new title cannot make loading or not-yet-synchronized previous prose ready', () => {
  expect(ready({ label: '/fixture/第200章.md', value: 'previous prose', loading: true }, 'writing')).toBe(false)
  expect(ready({ label: '/fixture/第200章.md', value: 'previous prose', syncedPath: '/fixture/第199章.md' }, 'writing')).toBe(false)
  expect(ready({ label: '/fixture/第200章.md', value: 'new prose', syncedPath: '' }, 'writing')).toBe(false)
})
