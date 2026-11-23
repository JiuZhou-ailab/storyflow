import { expect, it, mock } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { TURN_COMMENTARY_SUMMARY_BATCH_SIZE, type OneShotLlmRequest, type Session } from '@craft-agent/shared/protocol'
import { summarizeTurnCommentary } from './turn-commentary-summary'

function commentary(id: string, content: string): Message {
  return { id, content, role: 'assistant', isIntermediate: true, timestamp: 0 }
}

function sessionWith(messages: Message[]): Session {
  return {
    id: 'session', workspaceId: 'workspace', workspaceName: 'Project',
    isProcessing: false, lastMessageAt: 0, messages,
  }
}

it('only sends finalized commentary and associates each summary with its source message', async () => {
  const queryOnce = mock(async (_sessionId: string, _request: OneShotLlmRequest) => ({
    text: JSON.stringify(['核对原稿中的\n两个人名', '保留故事转折']),
  }))
  const getSession = mock(async () => sessionWith([
    commentary('first', 'Verify both names.'),
    { ...commentary('pending', 'Unfinished'), isPending: true },
    { ...commentary('user', 'User input'), role: 'user' },
    { ...commentary('final', 'Final answer'), isIntermediate: false },
    commentary('second', 'Keep the plot twist.'),
    commentary('unselected', 'Outside the opened turn.'),
  ]))

  const result = await summarizeTurnCommentary({ getSession, queryOnce }, 'session', [
    'second', 'pending', 'user', 'final', 'missing', 'first', 'first',
  ])

  expect(result.commentarySummaries).toEqual([
    { messageId: 'first', summary: '核对原稿中的 两个人名' },
    { messageId: 'second', summary: '保留故事转折' },
  ])
  expect(getSession).toHaveBeenCalledWith('session')
  expect(JSON.parse(queryOnce.mock.calls[0]![1].prompt)).toEqual(['Verify both names.', 'Keep the plot twist.'])
})

it('rejects oversized batches before reading the session and skips model calls for empty selections', async () => {
  const getSession = mock(async () => sessionWith([commentary('empty', '   ')]))
  const queryOnce = mock(async () => ({ text: '[]' }))
  const sessions = { getSession, queryOnce }

  await expect(summarizeTurnCommentary(sessions, 'session', Array(TURN_COMMENTARY_SUMMARY_BATCH_SIZE + 1).fill('id')))
    .rejects.toThrow('Invalid commentary message IDs')
  expect(getSession).not.toHaveBeenCalled()
  expect(await summarizeTurnCommentary(sessions, 'session', ['empty'])).toEqual({ commentarySummaries: [] })
  expect(queryOnce).not.toHaveBeenCalled()
})

it('keeps valid Chinese summaries when one segment lacks a usable summary', async () => {
  const getSession = async () => sessionWith([commentary('first', 'First'), commentary('second', 'Second')])
  const queryOnce = async () => ({ text: JSON.stringify(['First summary', '核对第二段']) })

  expect(await summarizeTurnCommentary({ getSession, queryOnce }, 'session', ['first', 'second'])).toEqual({
    commentarySummaries: [{ messageId: 'second', summary: '核对第二段' }],
  })
})
