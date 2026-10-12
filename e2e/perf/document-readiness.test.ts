import { expect, test } from 'bun:test'
import { writingDocumentReadyExpression } from './navigation'

function ready(input: { label: string; value: string } | null) {
  return new Function('document', `return ${writingDocumentReadyExpression(200)}`)({
    querySelector: () => input && { value: input.value, getAttribute: () => input.label },
  })
}

test('chapter readiness requires the requested document content, not a previous editor or loading shell', () => {
  expect(ready(null)).toBe(false)
  expect(ready({ label: '/fixture/第199章.md', value: 'previous chapter' })).toBe(false)
  expect(ready({ label: '/fixture/第200章.md', value: '' })).toBe(false)
  expect(ready({ label: '/fixture/第200章.md', value: 'requested chapter' })).toBe(true)
})
