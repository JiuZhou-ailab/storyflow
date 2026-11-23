// input: Real TurnCard props and streamed response fragments
// output: Rendered-body regression coverage across languages and stream lifecycles
// pos: Public chat component seam for first-content visibility

import * as React from 'react'
import { beforeAll, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

// Vite-owned worker URL is not available in the Bun SSR environment.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let TurnCard: typeof import('../TurnCard').TurnCard
beforeAll(async () => { TurnCard = (await import('../TurnCard')).TurnCard })

test('shows the first readable fragment without another chunk or completion', () => {
  for (const text of ['这是已经收到的中文正文。', '日本語の短い回答です。', 'Yes.', '中文 mixed reply', '```ts\nconst answer = 42']) {
    for (const age of [0, 3000, 10000]) {
      const html = renderToStaticMarkup(<TurnCard turnId="turn" activities={[]} isStreaming isComplete={false}
        response={{ text, isStreaming: true, streamStartTime: Date.now() - age }} />)
      expect(html).toContain('data-search-root="response"')
      expect(html).toContain(text.startsWith('```') ? 'answer' : text)
    }
  }
})

test('keeps blank fragments empty and displays completed received text', () => {
  const blank = renderToStaticMarkup(<TurnCard turnId="turn" activities={[]} isStreaming isComplete={false}
    response={{ text: ' \n ', isStreaming: true }} />)
  expect(blank).not.toContain('data-search-root="response"')
  const done = renderToStaticMarkup(<TurnCard turnId="turn" activities={[]} isStreaming={false} isComplete
    response={{ text: '最后一段正文', isStreaming: false }} />)
  expect(done).toContain('最后一段正文')
})

test('shows pending text from the real message-to-turn boundary before classification completes', async () => {
  const { groupMessagesByTurn } = await import('../turn-utils')
  const turns = groupMessagesByTurn([{ id: 'first', role: 'assistant', content: '首片正文', timestamp: 1, isStreaming: true, isPending: true }])
  const turn = turns[0]!
  expect(turn.type).toBe('assistant')
  if (turn.type !== 'assistant') throw new Error('Expected assistant turn')
  const html = renderToStaticMarkup(<TurnCard turnId={turn.turnId} activities={turn.activities} response={turn.response} isStreaming isComplete={false} />)
  expect(html).toContain('data-search-root="response"')
  expect(html).toContain('首片正文')
})

test('renders live Markdown at full length and shows streaming status during a pause', () => {
  const html = renderToStaticMarkup(<TurnCard turnId="turn" activities={[]} isStreaming isComplete={false}
    response={{ text: '## 正文\n\n**第一段**\n\n第二段\n\n最后一段', isStreaming: true }} />)
  expect(html).toMatch(/<strong\b[^>]*>第一段<\/strong>/)
  expect(html).toContain('最后一段')
  expect(html).toContain('Streaming...')
  expect(html).not.toContain('h-[1lh]')
})

test('keeps live process text in chronological activity rows and hides the collapsed summary in chat', async () => {
  const { groupMessagesByTurn } = await import('../turn-utils')
  const [turn] = groupMessagesByTurn([
    { id: 'process', role: 'assistant', content: '先检查原稿\n再读取第三章', timestamp: 1, isIntermediate: true },
    { id: 'read-tool', role: 'tool', content: '', timestamp: 2, toolName: 'Read', toolUseId: 'read-tool', toolInput: { file_path: 'chapter-3.md' } },
  ])
  if (turn?.type !== 'assistant') throw new Error('Expected assistant turn')
  const live = renderToStaticMarkup(<TurnCard {...turn} isExpanded hideCompletedActivitySummary />)
  expect(live).toContain('h-[1lh]')
  expect(live).toContain('flex-col-reverse')
  expect(live).toContain('先检查原稿\n再读取第三章')
  expect(live.match(/再读取第三章/g)).toHaveLength(1)
  expect(live.indexOf('再读取第三章')).toBeLessThan(live.indexOf('chapter-3.md'))

  const done = renderToStaticMarkup(<TurnCard {...turn} isComplete isExpanded={false} hideCompletedActivitySummary
    response={{ text: '**完成**', isStreaming: false }} />)
  expect(done).not.toContain('aria-expanded="false"')
  expect(done).not.toContain('chapter-3.md')
  expect(done).toMatch(/<strong\b[^>]*>完成<\/strong>/)
})

test('completed file links receive the current workspace navigation callback', () => {
  type Props = React.ComponentProps<typeof TurnCard>
  const compare = (TurnCard as unknown as { compare: (prev: Props, next: Props) => boolean }).compare
  const previous: Props = {
    turnId: 'welcome', activities: [], isStreaming: false, isComplete: true,
    onOpenFile: () => {},
  }
  expect(compare(previous, { ...previous })).toBe(true)
  expect(compare(previous, { ...previous, onOpenFile: () => {} })).toBe(false)
})

test('shows the recorded assistant model in full and compact chat after history reload', async () => {
  const { messageToStored, storedToMessage } = await import('@craft-agent/core/types')
  const { groupMessagesByTurn } = await import('../turn-utils')
  const stored = messageToStored({ id: 'reply', role: 'assistant', timestamp: 1, content: 'Done', model: 'deepseek-v4-pro' })
  const [turn] = groupMessagesByTurn([storedToMessage(stored)])
  if (turn?.type !== 'assistant') throw new Error('Expected assistant turn')
  for (const compactMode of [false, true]) {
    const html = renderToStaticMarkup(<TurnCard {...turn} compactMode={compactMode} />)
    expect(html).toContain('deepseek-v4-pro')
  }
})
