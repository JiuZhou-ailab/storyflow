// input: Feedback form payloads from the renderer
// output: Submitted feedback issue URLs through a safe main-process boundary
// pos: Main-process feedback submission adapter

const DEFAULT_FEEDBACK_ENDPOINT = 'https://storyflow-feedback.zjding.com/api/feedback'

export type FeedbackIssueAttachment = {
  name: string
  mimeType: string
  size: number
  base64: string
}

export type FeedbackIssueInput = {
  title: string
  message: string
  email?: string
  appVersion: string
  platform: string
  attachments: FeedbackIssueAttachment[]
}

export type FeedbackIssueResult = {
  url: string
}

export type FeedbackFetch = (url: string, init?: RequestInit) => Promise<Response>

export type SubmitFeedbackIssueDeps = {
  fetch?: FeedbackFetch
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeFeedbackIssueInput(raw: unknown): FeedbackIssueInput {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.flatMap((item) => {
      const attachment = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const name = cleanText(attachment.name)
      const mimeType = cleanText(attachment.mimeType) || 'application/octet-stream'
      const base64 = cleanText(attachment.base64)
      const size = typeof attachment.size === 'number' && Number.isFinite(attachment.size)
        ? attachment.size
        : 0
      return name && base64 ? [{ name, mimeType, size, base64 }] : []
    })
    : []

  return {
    title: cleanText(record.title),
    message: cleanText(record.message),
    email: cleanText(record.email) || undefined,
    appVersion: cleanText(record.appVersion),
    platform: cleanText(record.platform),
    attachments,
  }
}

async function postJson(
  fetchImpl: FeedbackFetch,
  url: string,
  body: unknown
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Feedback service is unreachable. Check your network and try again.')
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Feedback submission failed (${response.status}): ${text || response.statusText}`)
  }

  return await response.json().catch(() => ({}))
}

function resolveFeedbackEndpoint(): string {
  return cleanText(process.env.STORYFLOW_FEEDBACK_ENDPOINT) || DEFAULT_FEEDBACK_ENDPOINT
}

export async function submitFeedbackIssue(
  input: FeedbackIssueInput,
  deps: SubmitFeedbackIssueDeps = {}
): Promise<FeedbackIssueResult> {
  if (!input.title.trim()) throw new Error('Feedback title is required.')
  if (!input.message.trim()) throw new Error('Feedback details are required.')

  const endpoint = resolveFeedbackEndpoint()
  const data = await postJson(deps.fetch ?? fetch, endpoint, input)
  const url = data && typeof data === 'object' ? (data as Record<string, unknown>).url : undefined
  return { url: typeof url === 'string' ? url : endpoint }
}
