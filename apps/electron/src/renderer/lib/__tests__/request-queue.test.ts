import { describe, expect, it } from 'bun:test'
import { appendUniqueRequestById } from '../request-queue'

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
