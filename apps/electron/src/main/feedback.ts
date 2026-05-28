// input: Feedback form payloads from the renderer
// output: Submitted GitHub issue URLs through a safe main-process boundary
// pos: Main-process feedback submission adapter

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const FEEDBACK_REPOSITORY = 'JiuZhou-ailab/storyflow'
const DEFAULT_FEEDBACK_ENDPOINT = 'https://storyflow-feedback.d1095245867.workers.dev/api/feedback'
const execFileAsync = promisify(execFile)

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

export type SubmitFeedbackIssueDeps = {
  getGitHubToken?: () => Promise<string | null>
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

export function buildFeedbackIssueBody(input: FeedbackIssueInput): string {
  const lines = [
    '## Feedback',
    '',
    input.message,
    '',
    '## Context',
    '',
    `- App version: ${input.appVersion || 'unknown'}`,
    `- Platform: ${input.platform || 'unknown'}`,
  ]

  if (input.email) {
    lines.push('', '## Contact', '', input.email)
  }

  if (input.attachments.length > 0) {
    lines.push('', '## Attachments', '')
    for (const attachment of input.attachments) {
      lines.push(`- ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes)`)
    }
  }

  return lines.join('\n')
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Feedback submission failed (${response.status}): ${text || response.statusText}`)
  }

  return await response.json().catch(() => ({}))
}

async function getGitHubCliToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    return cleanText(stdout) || null
  } catch {
    return null
  }
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
  if (endpoint) {
    const data = await postJson(endpoint, input)
    const url = data && typeof data === 'object' ? (data as Record<string, unknown>).url : undefined
    return { url: typeof url === 'string' ? url : endpoint }
  }

  const token = cleanText(process.env.STORYFLOW_FEEDBACK_GITHUB_TOKEN)
    || cleanText(process.env.GITHUB_TOKEN)
    || cleanText(await (deps.getGitHubToken ?? getGitHubCliToken)())
  if (!token) {
    throw new Error('Feedback submission is not configured. Set STORYFLOW_FEEDBACK_ENDPOINT for production, STORYFLOW_FEEDBACK_GITHUB_TOKEN for local development, or run `gh auth login`.')
  }

  const issue = await postJson(
    `https://api.github.com/repos/${FEEDBACK_REPOSITORY}/issues`,
    {
      title: `[Feedback] ${input.title}`,
      body: buildFeedbackIssueBody(input),
      labels: ['feedback'],
    },
    {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    }
  )
  const htmlUrl = issue && typeof issue === 'object' ? (issue as Record<string, unknown>).html_url : undefined
  if (typeof htmlUrl !== 'string') {
    throw new Error('GitHub did not return an issue URL.')
  }
  return { url: htmlUrl }
}
