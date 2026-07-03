import { describe, expect, it } from 'bun:test'
import { appendUniqueRequestById, removeFirstRequestForSession } from '../request-queue'

describe('appendUniqueRequestById', () => {
  it('appends requests to an empty queue', () => {
    const request = { requestId: 'req-1', label: 'first' }

    expect(appendUniqueRequestById([], request)).toEqual([request])
  })

  it('keeps the original queue when requestId already exists', () => {
    const queue = [{ requestId: 'req-1', label: 'first' }]

    expect(appendUniqueRequestById(queue, { requestId: 'req-1', label: 'duplicate' })).toBe(queue)
  })

  it('appends distinct requestIds in FIFO order', () => {
    const queue = [{ requestId: 'req-1', label: 'first' }]
    const next = appendUniqueRequestById(queue, { requestId: 'req-2', label: 'second' })

    expect(next.map(request => request.requestId)).toEqual(['req-1', 'req-2'])
  })

  it('dedupes credential-shaped requests by requestId', () => {
    const queue = [{ requestId: 'cred-1', kind: 'credential', sourceSlug: 'github' }]

    expect(appendUniqueRequestById(queue, { requestId: 'cred-1', kind: 'credential', sourceSlug: 'github' })).toBe(queue)
  })
})

describe('removeFirstRequestForSession', () => {
  it('keeps the original map when the session queue is missing', () => {
    const queues = new Map([
      ['s1', [{ requestId: 'req-1' }]],
    ])

    expect(removeFirstRequestForSession(queues, 'missing')).toBe(queues)
  })

  it('keeps the original map when the session queue is empty', () => {
    const queues = new Map([
      ['s1', []],
    ])

    expect(removeFirstRequestForSession(queues, 's1')).toBe(queues)
  })

  it('removes only the first request for the session', () => {
    const queues = new Map([
      ['s1', [{ requestId: 'req-1' }, { requestId: 'req-2' }]],
    ])

    const next = removeFirstRequestForSession(queues, 's1')

    expect(next).not.toBe(queues)
    expect(next.get('s1')?.map(request => request.requestId)).toEqual(['req-2'])
  })

  it('deletes the session entry when the last request is removed', () => {
    const queues = new Map([
      ['s1', [{ requestId: 'req-1' }]],
    ])

    const next = removeFirstRequestForSession(queues, 's1')

    expect(next.has('s1')).toBe(false)
  })
})
