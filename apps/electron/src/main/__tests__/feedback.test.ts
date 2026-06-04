// input: User-submitted feedback form payloads
// output: Regression coverage for issue body and submission routing
// pos: Keeps desktop feedback issue creation safe and deterministic

import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  submitFeedbackIssue,
  type FeedbackFetch,
  type FeedbackIssueInput,
} from '../feedback'

const originalFetch = globalThis.fetch
const originalEnv = {
  STORYFLOW_FEEDBACK_ENDPOINT: process.env.STORYFLOW_FEEDBACK_ENDPOINT,
  CRAFT_IS_PACKAGED: process.env.CRAFT_IS_PACKAGED,
}

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const input: FeedbackIssueInput = {
  title: 'Paste screenshot support',
  message: 'The feedback form should accept pasted screenshots.',
  email: 'user@example.com',
  appVersion: '0.9.20',
  platform: 'darwin',
  attachments: [
    {
      name: 'pasted-image-1.png',
      mimeType: 'image/png',
      size: 1234,
      base64: 'iVBORw0KGgo=',
    },
  ],
}

describe('desktop feedback issue submission', () => {
  it('posts the full payload to the configured feedback endpoint', async () => {
    process.env.STORYFLOW_FEEDBACK_ENDPOINT = 'https://feedback.example.com/issues'
    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://feedback.example.com/issues')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual(input)
      return Response.json({ url: 'https://github.com/JiuZhou-ailab/storyflow/issues/123' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(submitFeedbackIssue(input)).resolves.toEqual({
      url: 'https://github.com/JiuZhou-ailab/storyflow/issues/123',
    })
  })

  it('uses the first-party feedback worker domain when feedback env vars are not configured', async () => {
    delete process.env.STORYFLOW_FEEDBACK_ENDPOINT
    delete process.env.CRAFT_IS_PACKAGED

    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://storyflow-feedback.zjding.com/api/feedback')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual(input)
      return Response.json({ url: 'https://github.com/JiuZhou-ailab/storyflow/issues/124' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(submitFeedbackIssue(input)).resolves.toEqual({
      url: 'https://github.com/JiuZhou-ailab/storyflow/issues/124',
    })
  })

  it('uses the first-party feedback worker domain by default in packaged builds', async () => {
    delete process.env.STORYFLOW_FEEDBACK_ENDPOINT
    process.env.CRAFT_IS_PACKAGED = '1'

    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://storyflow-feedback.zjding.com/api/feedback')
      expect(init?.method).toBe('POST')
      return Response.json({ url: 'https://github.com/JiuZhou-ailab/storyflow/issues/88' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(submitFeedbackIssue(input)).resolves.toEqual({
      url: 'https://github.com/JiuZhou-ailab/storyflow/issues/88',
    })
  })

  it('allows the Electron main process to use its Chromium network stack for worker submissions', async () => {
    delete process.env.STORYFLOW_FEEDBACK_ENDPOINT

    globalThis.fetch = mock(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const electronFetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://storyflow-feedback.zjding.com/api/feedback')
      expect(init?.method).toBe('POST')
      return Response.json({ url: 'https://github.com/JiuZhou-ailab/storyflow/issues/125' })
    })

    await expect(submitFeedbackIssue(input, {
      fetch: electronFetch as unknown as FeedbackFetch,
    })).resolves.toEqual({
      url: 'https://github.com/JiuZhou-ailab/storyflow/issues/125',
    })
    expect(electronFetch).toHaveBeenCalledTimes(1)
  })

  it('turns feedback worker network failures into a user-facing service error', async () => {
    delete process.env.STORYFLOW_FEEDBACK_ENDPOINT

    await expect(submitFeedbackIssue(input, {
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })).rejects.toThrow('Feedback service is unreachable')
  })
})
