// input: Public feedback requests, Cloudflare IP rate limiter, optional R2, and GitHub credentials
// output: Size-bounded GitHub feedback issues with validated raster screenshot links
// pos: Edge ingestion boundary for user feedback without exposing GitHub tokens to desktop clients

export interface Env {
  FEEDBACK_GITHUB_TOKEN?: string
  GITHUB_TOKEN?: string
  GITHUB_REPOSITORY?: string
  FEEDBACK_GITHUB_LABELS?: string
  FEEDBACK_ASSET_PUBLIC_BASE_URL?: string
  FEEDBACK_ASSETS?: R2BucketLike
  FEEDBACK_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: {
    httpMetadata?: {
      contentType?: string
    }
    customMetadata?: Record<string, string>
  }): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
}

interface R2ObjectLike {
  body: BodyInit | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array> | null
  httpMetadata?: {
    contentType?: string
  }
}

interface FeedbackAttachment {
  name: string
  mimeType: string
  size: number
  bytes: Uint8Array
}

interface FeedbackPayload {
  title: string
  message: string
  email?: string
  appVersion?: string
  platform?: string
  attachments: FeedbackAttachment[]
}

interface UploadedAttachment {
  name: string
  mimeType: string
  size: number
  url?: string
}

const DEFAULT_REPOSITORY = 'JiuZhou-ailab/storyflow'
const DEFAULT_LABELS = ['feedback', 'ai-triage']
const MAX_TITLE_LENGTH = 200
const MAX_MESSAGE_LENGTH = 12_000
const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024
// Base64 adds 4/3 overhead; reserve another MiB for JSON and feedback metadata.
const MAX_REQUEST_BYTES = 21 * 1024 * 1024
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, fetch)
  },
}

export async function handleRequest(
  request: Request,
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return corsResponse(null, { status: 204 })
  if (url.pathname === '/health' && request.method === 'GET') {
    return corsJson({ status: 'ok' })
  }
  if (url.pathname.startsWith('/assets/') && request.method === 'GET') {
    return handleAssetRequest(url, env)
  }
  if (url.pathname !== '/api/feedback' || request.method !== 'POST') {
    return corsJson({ error: 'Not found' }, { status: 404 })
  }

  try {
    if (!env.FEEDBACK_RATE_LIMITER) throw new Error('Feedback submission failed')
    const { success } = await env.FEEDBACK_RATE_LIMITER.limit({
      key: `feedback:${request.headers.get('cf-connecting-ip') || 'unknown'}`,
    })
    if (!success) {
      await request.body?.cancel()
      return corsJson({ error: 'Feedback submission failed' }, { status: 429, headers: { 'retry-after': '60' } })
    }
    const payload = normalizeFeedbackPayload(await readJsonObject(request))
    const uploadedAttachments = await uploadAttachments(payload.attachments, env, url.origin)
    const issue = await createGitHubIssue(payload, uploadedAttachments, env, fetchImpl)
    return corsJson({
      ok: true,
      url: issue.url,
      issueUrl: issue.url,
      issueNumber: issue.number,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Feedback submission failed'
    const status = error instanceof ValidationError ? error.status : 502
    return corsJson({ error: message }, { status })
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ValidationError('Feedback request must be JSON.')
  }
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) {
    await request.body?.cancel()
    throw new ValidationError('Feedback screenshots are too large.', 413)
  }
  const reader = request.body?.getReader()
  let buffer = new Uint8Array(0)
  let bytes = 0
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > MAX_REQUEST_BYTES) {
          await reader.cancel()
          throw new ValidationError('Feedback screenshots are too large.', 413)
        }
        // Bound retained memory by bytes, not the number of client-supplied chunks.
        if (bytes > buffer.byteLength) {
          const grown = new Uint8Array(Math.min(MAX_REQUEST_BYTES, Math.max(64 * 1024, buffer.byteLength * 2, bytes)))
          grown.set(buffer)
          buffer = grown
        }
        buffer.set(chunk.value, bytes - chunk.value.byteLength)
      }
    } finally {
      reader.releaseLock()
    }
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(buffer.subarray(0, bytes)))
  } catch {
    throw new ValidationError('Feedback request body must be an object.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Feedback request body must be an object.')
  }
  return value as Record<string, unknown>
}

function normalizeFeedbackPayload(raw: Record<string, unknown>): FeedbackPayload {
  const title = readString(raw.title)
  const message = readString(raw.message)
  if (!title) throw new ValidationError('Feedback title is required.')
  if (!message) throw new ValidationError('Feedback details are required.')
  if (title.length > MAX_TITLE_LENGTH) throw new ValidationError('Feedback title is too long.')
  if (message.length > MAX_MESSAGE_LENGTH) throw new ValidationError('Feedback details are too long.')

  const rawAttachments = Array.isArray(raw.attachments) ? raw.attachments : []
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    throw new ValidationError(`Feedback supports at most ${MAX_ATTACHMENTS} screenshots.`)
  }

  const attachments = rawAttachments.map(normalizeAttachment)
  let totalBytes = 0
  for (const attachment of attachments) {
    totalBytes += attachment.size
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      throw new ValidationError(`Screenshot ${attachment.name} is too large.`)
    }
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new ValidationError('Feedback screenshots are too large.')
    }
  }

  return {
    title,
    message,
    ...(readString(raw.email) ? { email: readString(raw.email) } : {}),
    ...(readString(raw.appVersion) ? { appVersion: readString(raw.appVersion) } : {}),
    ...(readString(raw.platform) ? { platform: readString(raw.platform) } : {}),
    attachments,
  }
}

function normalizeAttachment(raw: unknown): FeedbackAttachment {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const name = sanitizeFileName(readString(record.name) || 'screenshot.png')
  const mimeType = readString(record.mimeType) || 'application/octet-stream'
  const base64 = readString(record.base64)
  if (!base64) throw new ValidationError(`Screenshot ${name} is missing image data.`)
  if (!IMAGE_MIME_TYPES.has(mimeType)) throw new ValidationError(`Screenshot ${name} must be an image.`)

  if (estimateBase64Bytes(base64) > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError(`Screenshot ${name} is too large.`)
  }
  const bytes = decodeBase64(base64)
  const size = bytes.byteLength
  if (size > MAX_ATTACHMENT_BYTES) throw new ValidationError(`Screenshot ${name} is too large.`)
  if (sniffImageMimeType(bytes) !== mimeType) {
    throw new ValidationError(`Screenshot ${name} must be an image.`)
  }
  if (record.size !== undefined && record.size !== size) {
    throw new ValidationError(`Screenshot ${name} has invalid image data.`)
  }

  return {
    name,
    mimeType,
    size,
    bytes,
  }
}

function sniffImageMimeType(bytes: Uint8Array): string | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  const header = String.fromCharCode(...bytes.subarray(0, 12))
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif'
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp'
  return undefined
}

async function handleAssetRequest(url: URL, env: Env): Promise<Response> {
  const bucket = env.FEEDBACK_ASSETS
  if (!bucket) return corsJson({ error: 'Feedback asset storage is not configured.' }, { status: 404 })

  const key = decodeURIComponent(url.pathname.slice('/assets/'.length))
  if (!key || key.includes('..')) return corsJson({ error: 'Not found' }, { status: 404 })

  const object = await bucket.get(key)
  if (!object || !IMAGE_MIME_TYPES.has(object.httpMetadata?.contentType ?? '')) {
    return corsJson({ error: 'Not found' }, { status: 404 })
  }

  return corsResponse(object.body as BodyInit | null, {
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}

async function uploadAttachments(attachments: FeedbackAttachment[], env: Env, workerOrigin: string): Promise<UploadedAttachment[]> {
  if (attachments.length === 0) return []
  const bucket = env.FEEDBACK_ASSETS
  const publicBaseUrl = readString(env.FEEDBACK_ASSET_PUBLIC_BASE_URL)
    || (bucket ? `${workerOrigin}/assets` : undefined)
  const feedbackId = crypto.randomUUID()

  const uploaded: UploadedAttachment[] = []
  for (const attachment of attachments) {
    const key = `feedback/${new Date().toISOString().slice(0, 10)}/${feedbackId}/${attachment.name}`
    if (bucket) {
      await bucket.put(key, attachment.bytes, {
        httpMetadata: { contentType: attachment.mimeType },
        customMetadata: {
          originalName: attachment.name,
        },
      })
    }
    uploaded.push({
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      ...(publicBaseUrl && bucket ? { url: `${publicBaseUrl.replace(/\/+$/, '')}/${encodeURI(key)}` } : {}),
    })
  }
  return uploaded
}

async function createGitHubIssue(
  payload: FeedbackPayload,
  attachments: UploadedAttachment[],
  env: Env,
  fetchImpl: FetchLike,
): Promise<{ url: string, number: number }> {
  const token = readString(env.FEEDBACK_GITHUB_TOKEN) || readString(env.GITHUB_TOKEN)
  if (!token) throw new Error('Feedback GitHub token is not configured.')

  const repository = readString(env.GITHUB_REPOSITORY) || DEFAULT_REPOSITORY
  const labels = parseLabels(env.FEEDBACK_GITHUB_LABELS)
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/issues`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'storyflow-feedback-worker',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({
      title: `[Feedback] ${payload.title}`,
      body: buildIssueBody(payload, attachments),
      labels,
    }),
  })

  const body = await parseJsonObject(response)
  if (!response.ok) {
    const message = readString(body.message) || response.statusText
    throw new Error(`GitHub issue creation failed (${response.status}): ${message}`)
  }

  const url = readString(body.html_url)
  const number = readPositiveInteger(body.number)
  if (!url || !number) throw new Error('GitHub did not return an issue URL.')
  return { url, number }
}

function buildIssueBody(payload: FeedbackPayload, attachments: UploadedAttachment[]): string {
  const lines = [
    '## Feedback',
    '',
    payload.message,
    '',
    '## Context',
    '',
    `- App version: ${payload.appVersion || 'unknown'}`,
    `- Platform: ${payload.platform || 'unknown'}`,
  ]

  if (payload.email) {
    lines.push('', '## Contact', '', payload.email)
  }

  if (attachments.length > 0) {
    lines.push('', '## Screenshots', '')
    for (const attachment of attachments) {
      const label = `${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes)`
      lines.push(attachment.url ? `![${label}](${attachment.url})` : `- ${label}`)
    }
  }

  return lines.join('\n')
}

function parseLabels(value: string | undefined): string[] {
  const labels = readString(value)
    ?.split(',')
    .map(label => label.trim())
    .filter(Boolean)
  return labels && labels.length > 0 ? labels : DEFAULT_LABELS
}

async function parseJsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function sanitizeFileName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized || 'screenshot.png'
}

function estimateBase64Bytes(value: string): number {
  const normalized = value.replace(/\s+/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.floor((normalized.length * 3) / 4) - padding
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '')
  try {
    const binary = atob(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    throw new ValidationError('Screenshot image data must be base64 encoded.')
  }
}

function corsJson(body: unknown, init: ResponseInit = {}): Response {
  return corsResponse(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  })
}

function corsResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'POST, OPTIONS')
  headers.set('access-control-allow-headers', 'content-type')
  return new Response(body, { ...init, headers })
}

class ValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}
