// input: Feedback Worker requests, fake R2 storage, and GitHub fetch stubs
// output: Regression coverage for feedback validation, attachment upload, and issue creation
// pos: Tests the public feedback ingestion boundary before it reaches GitHub
import { describe, expect, it } from 'bun:test'
import { handleRequest, type Env } from './index'

class FakeR2Bucket {
  objects = new Map<string, { value: Uint8Array, contentType?: string }>()

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    this.objects.set(key, {
      value: value instanceof Uint8Array ? value : new Uint8Array(value),
      contentType: options?.httpMetadata?.contentType,
    })
  }

  async get(key: string): Promise<{ body: Uint8Array, httpMetadata: { contentType?: string } } | null> {
    const object = this.objects.get(key)
    if (!object) return null
    return {
      body: object.value,
      httpMetadata: { contentType: object.contentType },
    }
  }
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    FEEDBACK_GITHUB_TOKEN: 'github-token',
    GITHUB_REPOSITORY: 'JiuZhou-ailab/storyflow',
    FEEDBACK_GITHUB_LABELS: 'feedback,ai-triage',
    ...overrides,
  }
}

function makeRequest(body: unknown): Request {
  return new Request('https://feedback.example.com/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('feedback worker', () => {
  it('creates a GitHub issue and uploads pasted screenshots to R2', async () => {
    const bucket = new FakeR2Bucket()
    let githubRequest: Request | null = null

    const response = await handleRequest(
      makeRequest({
        title: 'Cannot export chapter',
        message: 'Export fails after selecting PDF.',
        email: 'user@example.com',
        appVersion: '0.9.20',
        platform: 'darwin arm64',
        attachments: [{
          name: 'Screen Shot 2026-05-28.png',
          mimeType: 'image/png',
          size: 5,
          base64: btoa('image'),
        }],
      }),
      makeEnv({
        FEEDBACK_ASSETS: bucket,
        FEEDBACK_ASSET_PUBLIC_BASE_URL: 'https://feedback-assets.example.com',
      }),
      async (request, init) => {
        githubRequest = new Request(request, init)
        return Response.json({
          html_url: 'https://github.com/JiuZhou-ailab/storyflow/issues/123',
          number: 123,
        })
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      url: 'https://github.com/JiuZhou-ailab/storyflow/issues/123',
      issueUrl: 'https://github.com/JiuZhou-ailab/storyflow/issues/123',
      issueNumber: 123,
    })
    expect(bucket.objects.size).toBe(1)
    const [[assetKey, asset]] = [...bucket.objects.entries()]
    expect(assetKey).toContain('Screen-Shot-2026-05-28.png')
    expect(asset.contentType).toBe('image/png')
    expect(new TextDecoder().decode(asset.value)).toBe('image')

    expect(githubRequest?.url).toBe('https://api.github.com/repos/JiuZhou-ailab/storyflow/issues')
    expect(githubRequest?.headers.get('authorization')).toBe('Bearer github-token')
    const issueBody = await githubRequest?.json() as Record<string, unknown>
    expect(issueBody.title).toBe('[Feedback] Cannot export chapter')
    expect(issueBody.labels).toEqual(['feedback', 'ai-triage'])
    expect(issueBody.body).toContain('Export fails after selecting PDF.')
    expect(issueBody.body).toContain(`![Screen-Shot-2026-05-28.png (image/png, 5 bytes)](https://feedback-assets.example.com/${assetKey})`)
  })

  it('serves uploaded screenshots through the feedback worker when no public asset URL is configured', async () => {
    const bucket = new FakeR2Bucket()
    let assetUrl: string | undefined

    const response = await handleRequest(
      makeRequest({
        title: 'Screenshot broken',
        message: 'The screenshot should render in GitHub.',
        attachments: [{
          name: 'pasted screenshot.png',
          mimeType: 'image/png',
          size: 5,
          base64: btoa('image'),
        }],
      }),
      makeEnv({ FEEDBACK_ASSETS: bucket }),
      async (_request, init) => {
        const issueBody = JSON.parse(String(init?.body)) as Record<string, string>
        const match = issueBody.body.match(/\((https:\/\/feedback\.example\.com\/assets\/[^)]+)\)/)
        assetUrl = match?.[1]
        return Response.json({
          html_url: 'https://github.com/JiuZhou-ailab/storyflow/issues/124',
          number: 124,
        })
      },
    )

    expect(response.status).toBe(200)
    expect(assetUrl).toBeTruthy()

    const assetResponse = await handleRequest(
      new Request(assetUrl!),
      makeEnv({ FEEDBACK_ASSETS: bucket }),
      async () => Response.json({}),
    )
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('content-type')).toBe('image/png')
    expect(await assetResponse.text()).toBe('image')
  })

  it('rejects invalid feedback before reaching GitHub', async () => {
    let githubCalled = false

    const response = await handleRequest(
      makeRequest({ title: '', message: 'missing title', attachments: [] }),
      makeEnv(),
      async () => {
        githubCalled = true
        return Response.json({})
      },
    )

    expect(response.status).toBe(400)
    expect(githubCalled).toBe(false)
  })

  it('rejects more than five screenshots', async () => {
    const attachments = Array.from({ length: 6 }, (_, index) => ({
      name: `screenshot-${index}.png`,
      mimeType: 'image/png',
      size: 1,
      base64: btoa('x'),
    }))

    const response = await handleRequest(
      makeRequest({ title: 'Too many', message: 'Too many screenshots', attachments }),
      makeEnv(),
      async () => Response.json({}),
    )

    expect(response.status).toBe(400)
  })

  it('handles CORS preflight requests', async () => {
    const response = await handleRequest(
      new Request('https://feedback.example.com/api/feedback', { method: 'OPTIONS' }),
      makeEnv(),
      async () => Response.json({}),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })
})
