import { expect, test } from 'bun:test'
import { writingDocumentReadyExpression } from './navigation'

function ready(input: { label: string; value: string } | null, view: 'source' | 'writing' = 'source') {
  return new Function('document', `return ${writingDocumentReadyExpression(200)}`)({
    querySelector: (selector: string) => {
      if (!input) return null
      if (selector.startsWith('textarea')) return view === 'source' ? { value: input.value, getAttribute: () => input.label } : null
      return view === 'writing' ? { querySelector: (child: string) => child === 'p[title]'
        ? { getAttribute: () => input.label } : { textContent: input.value } } : null
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
