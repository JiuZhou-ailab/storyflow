import { expect, test } from 'bun:test'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import { SessionBroadcaster } from './session-broadcaster'

test('batches only deltas from the same text block and classification', () => {
  const broadcaster = new SessionBroadcaster()
  const events: SessionEvent[] = []
  broadcaster.setEventSink((_channel, _target, event) => events.push(event))

  try {
    broadcaster.queueDelta('session', 'workspace', 'Thinking ', 'reason', true)
    broadcaster.queueDelta('session', 'workspace', 'continues', 'reason', true)
    broadcaster.queueDelta('session', 'workspace', 'Next thought', 'next-reason', true)
    broadcaster.queueDelta('session', 'workspace', 'Answer', 'next-reason')
    broadcaster.flushDelta('session', 'workspace')

    expect(events).toEqual([
      { type: 'text_delta', sessionId: 'session', delta: 'Thinking continues', turnId: 'reason', isIntermediate: true },
      { type: 'text_delta', sessionId: 'session', delta: 'Next thought', turnId: 'next-reason', isIntermediate: true },
      { type: 'text_delta', sessionId: 'session', delta: 'Answer', turnId: 'next-reason' },
    ])
  } finally {
    broadcaster.dispose()
  }
})
