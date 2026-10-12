// input: Feedback Worker requests, fake R2 storage, and GitHub fetch stubs
// output: Regression coverage for feedback validation, attachment upload, and issue creation
// pos: Tests the public feedback ingestion boundary before it reaches GitHub
import { describe, expect, it } from 'bun:test'
import { handleRequest, type Env } from './index'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const pngBytes = Uint8Array.from(atob(PNG), char => char.charCodeAt(0))


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
    FEEDBACK_RATE_LIMITER: { limit: async () => ({ success: true }) },
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
          size: pngBytes.length,
          base64: PNG,
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
    expect(asset.value).toEqual(pngBytes)

    expect(githubRequest?.url).toBe('https://api.github.com/repos/JiuZhou-ailab/storyflow/issues')
    expect(githubRequest?.headers.get('authorization')).toBe('Bearer github-token')
    const issueBody = await githubRequest?.json() as Record<string, unknown>
    expect(issueBody.title).toBe('[Feedback] Cannot export chapter')
    expect(issueBody.labels).toEqual(['feedback', 'ai-triage'])
    expect(issueBody.body).toContain('Export fails after selecting PDF.')
    expect(issueBody.body).toContain(`![Screen-Shot-2026-05-28.png (image/png, ${pngBytes.length} bytes)](https://feedback-assets.example.com/${assetKey})`)
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
          size: pngBytes.length,
          base64: PNG,
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
    expect(new Uint8Array(await assetResponse.arrayBuffer())).toEqual(pngBytes)
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

for (const [mimeType, data] of [
  ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
  ['image/png', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ['image/png', '<html>not a screenshot</html>'],
  ['image/jpeg', atob(PNG)],
  ['image/tiff', 'II*\0content'],
] as const) {
  it(`rejects ${mimeType} with unsupported or mismatched bytes before side effects`, async () => {
    const bucket = new FakeR2Bucket()
    let calls = 0
    const response = await handleRequest(makeRequest({
      title: 'Security', message: 'Test',
      attachments: [{ name: 'image.png', mimeType, size: data.length, base64: btoa(data) }],
    }), makeEnv({ FEEDBACK_ASSETS: bucket }), async () => {
      calls++
      return Response.json({ html_url: 'https://github.com/example/issues/1', number: 1 })
    })
    expect(response.status).toBe(400)
    expect(bucket.objects.size).toBe(0)
    expect(calls).toBe(0)
  })
}

it('limits request bytes even without Content-Length and cancels an oversized stream', async () => {
  let canceled = false, calls = 0, chunks = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (++chunks > 24) controller.close(); else controller.enqueue(new Uint8Array(1024 * 1024).fill(32)) },
    cancel() { canceled = true },
  })
  const response = await handleRequest(new Request('https://feedback.example.com/api/feedback', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  }), makeEnv(), async () => { calls++; return Response.json({}) })
  expect(response.status).toBe(413)
  expect(canceled).toBe(true)
  expect(calls).toBe(0)
})

it('rate limits by trusted client IP before parsing or external side effects', async () => {
  let key = '', githubCalls = 0
  const request = makeRequest({ title: 'Feedback', message: 'test' })
  request.headers.set('cf-connecting-ip', '192.0.2.1')
  request.headers.set('x-forwarded-for', '192.0.2.99')
  const response = await handleRequest(request, makeEnv({
    FEEDBACK_RATE_LIMITER: { limit: async (input: { key: string }) => { key = input.key; return { success: false } } },
  }), async () => { githubCalls++; return Response.json({}) })
  expect(response.status).toBe(429)
  expect(response.headers.get('retry-after')).toBe('60')
  expect(key).toBe('feedback:192.0.2.1')
  expect(githubCalls).toBe(0)
})

it('fails closed when the rate limit binding is missing', async () => {
  let calls = 0
  const response = await handleRequest(makeRequest({ title: 'Feedback', message: 'test' }),
    makeEnv({ FEEDBACK_RATE_LIMITER: undefined }),
    async () => { calls++; return Response.json({ html_url: 'https://github.com/example/issues/1', number: 1 }) })
  expect(response.status).toBe(502)
  expect(calls).toBe(0)
})

it('rejects dishonest sizes, invalid base64, and attachments over 5 MiB before upload', async () => {
  const large = new Uint8Array(5 * 1024 * 1024 + 1)
  large.set(pngBytes)
  for (const attachment of [
    { mimeType: 'image/png', base64: PNG, size: 1 },
    { mimeType: 'image/png', base64: '!!!!' },
    { mimeType: 'image/png', base64: Buffer.from(large).toString('base64'), size: 1 },
  ]) {
    const bucket = new FakeR2Bucket()
    let calls = 0
    const response = await handleRequest(makeRequest({ title: 'Test', message: 'Test', attachments: [attachment] }),
      makeEnv({ FEEDBACK_ASSETS: bucket }), async () => { calls++; return Response.json({}) })
    expect(response.status).toBe(400)
    expect(bucket.objects.size).toBe(0)
    expect(calls).toBe(0)
  }
})

it('enforces the decoded 15 MiB aggregate limit and accepts its exact boundary', async () => {
  const bytes = new Uint8Array(5 * 1024 * 1024)
  bytes.set(pngBytes)
  const attachment = { name: 'large.png', mimeType: 'image/png', size: bytes.length, base64: Buffer.from(bytes).toString('base64') }
  for (const extra of [false, true]) {
    let calls = 0
    const response = await handleRequest(makeRequest({
      title: 'Test', message: 'Test', attachments: [attachment, attachment, attachment,
        ...(extra ? [{ name: 'extra.png', mimeType: 'image/png', size: pngBytes.length, base64: PNG }] : [])],
    }), makeEnv(), async () => {
      calls++
      return Response.json({ html_url: 'https://github.com/example/issues/1', number: 1 })
    })
    expect(response.status).toBe(extra ? 400 : 200)
    expect(calls).toBe(extra ? 0 : 1)
  }
})

it('rejects oversized Content-Length before reading the body', async () => {
  const request = makeRequest({ title: 'Test', message: 'Test' })
  request.headers.set('content-length', String(22 * 1024 * 1024))
  const response = await handleRequest(request, makeEnv(), async () => Response.json({}))
  expect(response.status).toBe(413)
})

it('does not serve legacy SVG uploads and serves raster assets with nosniff', async () => {
  const bucket = new FakeR2Bucket()
  await bucket.put('old.svg', new TextEncoder().encode('<svg/>'), { httpMetadata: { contentType: 'image/svg+xml' } })
  await bucket.put('new.png', pngBytes, { httpMetadata: { contentType: 'image/png' } })
  const svg = await handleRequest(new Request('https://feedback.example.com/assets/old.svg'), makeEnv({ FEEDBACK_ASSETS: bucket }))
  expect(svg.status).toBe(404)
  const png = await handleRequest(new Request('https://feedback.example.com/assets/new.png'), makeEnv({ FEEDBACK_ASSETS: bucket }))
  expect(png.status).toBe(200)
  expect(png.headers.get('x-content-type-options')).toBe('nosniff')
})

it('accepts fragmented UTF-8 JSON without retaining a string for every chunk', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ title: '截图反馈', message: '细节说明' }))
  let offset = 0, title = ''
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) controller.close()
      else controller.enqueue(bytes.subarray(offset, ++offset))
    },
  })
  const response = await handleRequest(new Request('https://feedback.example.com/api/feedback', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  }), makeEnv(), async (_url, init) => {
    title = JSON.parse(String(init?.body)).title
    return Response.json({ html_url: 'https://github.com/example/issues/1', number: 1 })
  })
  expect(response.status).toBe(200)
  expect(title).toBe('[Feedback] 截图反馈')
})
