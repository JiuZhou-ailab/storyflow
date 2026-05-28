// input: User-submitted feedback form payloads
// output: Regression coverage for issue body and submission routing
// pos: Keeps desktop feedback issue creation safe and deterministic

import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  buildFeedbackIssueBody,
  submitFeedbackIssue,
  type FeedbackIssueInput,
} from '../feedback'

const originalFetch = globalThis.fetch
const originalEnv = {
  STORYFLOW_FEEDBACK_ENDPOINT: process.env.STORYFLOW_FEEDBACK_ENDPOINT,
  STORYFLOW_FEEDBACK_GITHUB_TOKEN: process.env.STORYFLOW_FEEDBACK_GITHUB_TOKEN,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
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
  it('builds an issue body with context and attachment facts', () => {
    const body = buildFeedbackIssueBody(input)

    expect(body).toContain('## Feedback')
    expect(body).toContain('The feedback form should accept pasted screenshots.')
    expect(body).toContain('## Contact')
    expect(body).toContain('user@example.com')
    expect(body).toContain('- App version: 0.9.20')
    expect(body).toContain('- Platform: darwin')
    expect(body).toContain('- pasted-image-1.png (image/png, 1234 bytes)')
  })

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

  it('uses the deployed feedback worker when feedback env vars are not configured', async () => {
    delete process.env.STORYFLOW_FEEDBACK_ENDPOINT
    delete process.env.STORYFLOW_FEEDBACK_GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    delete process.env.CRAFT_IS_PACKAGED

    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://storyflow-feedback.d1095245867.workers.dev/api/feedback')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual(input)
      return Response.json({ url: 'https://github.com/JiuZhou-ailab/storyflow/issues/124' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(submitFeedbackIssue(input, {
      getGitHubToken: async () => {
        throw new Error('default feedback submissions should not require local GitHub auth')
      },
    })).resolves.toEqual({
      url: 'https://github.com/JiuZhou-ailab/storyflow/issues/124',
    })
  })

  it('uses the deployed feedback worker by default in packaged builds', async () => {
    delete process.env.STORYFLOW_FEEDBACK_ENDPOINT
    delete process.env.STORYFLOW_FEEDBACK_GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    process.env.CRAFT_IS_PACKAGED = '1'

    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://storyflow-feedback.d1095245867.workers.dev/api/feedback')
      expect(init?.method).toBe('POST')
      return Response.json({ url: 'https://github.com/JiuZhou-ailab/storyflow/issues/88' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(submitFeedbackIssue(input, {
      getGitHubToken: async () => {
        throw new Error('packaged builds should not require local GitHub auth')
      },
    })).resolves.toEqual({
      url: 'https://github.com/JiuZhou-ailab/storyflow/issues/88',
    })
  })
})
