// input: Public desktop feedback requests, optional R2 binding, and server-side GitHub credentials
// output: GitHub issues with optional screenshot links
// pos: Edge ingestion boundary for user feedback without exposing GitHub tokens to desktop clients

export interface Env {
  FEEDBACK_GITHUB_TOKEN?: string
  GITHUB_TOKEN?: string
  GITHUB_REPOSITORY?: string
  FEEDBACK_GITHUB_LABELS?: string
  FEEDBACK_ASSET_PUBLIC_BASE_URL?: string
  FEEDBACK_ASSETS?: R2BucketLike
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
  base64: string
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
    const status = error instanceof ValidationError ? 400 : 502
    return corsJson({ error: message }, { status })
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ValidationError('Feedback request must be JSON.')
  }
  const value = await request.json().catch(() => null)
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

  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.map(normalizeAttachment)
    : []
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new ValidationError(`Feedback supports at most ${MAX_ATTACHMENTS} screenshots.`)
  }

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
  if (!mimeType.startsWith('image/')) throw new ValidationError(`Screenshot ${name} must be an image.`)

  const decodedSize = estimateBase64Bytes(base64)
  const size = readPositiveInteger(record.size) || decodedSize
  if (Math.abs(size - decodedSize) > 2) {
    throw new ValidationError(`Screenshot ${name} has invalid image data.`)
  }

  return {
    name,
    mimeType,
    size,
    base64,
  }
}

async function handleAssetRequest(url: URL, env: Env): Promise<Response> {
  const bucket = env.FEEDBACK_ASSETS
  if (!bucket) return corsJson({ error: 'Feedback asset storage is not configured.' }, { status: 404 })

  const key = decodeURIComponent(url.pathname.slice('/assets/'.length))
  if (!key || key.includes('..')) return corsJson({ error: 'Not found' }, { status: 404 })

  const object = await bucket.get(key)
  if (!object) return corsJson({ error: 'Not found' }, { status: 404 })

  return corsResponse(object.body as BodyInit | null, {
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
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
    const bytes = decodeBase64(attachment.base64)
    const key = `feedback/${new Date().toISOString().slice(0, 10)}/${feedbackId}/${attachment.name}`
    if (bucket) {
      await bucket.put(key, bytes, {
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

class ValidationError extends Error {}
