// input: Git commit metadata, generated release-note markdown, and local notification state
// output: What's New manifest helpers, accessible accent colors, and rate-limit decisions
// pos: Shared release-note generation and desktop display policy boundary

import { createHash } from 'node:crypto'

export interface WhatsNewCommit {
  hash: string
  subject: string
  body?: string
}

export interface WhatsNewManifest {
  version: string
  digest: string
  generatedAt: string
  title: string
  summary: string
  highlights?: string[]
  accentColor: string
  accentTextColor: '#ffffff'
  source: {
    commitCount: number
    userVisibleCommitCount: number
  }
}

export interface WhatsNewDraft {
  markdown: string
  manifest: WhatsNewManifest
}

export interface BuildWhatsNewDraftInput {
  version: string
  generatedAt: string
  commits: WhatsNewCommit[]
  aiSummary?: string
}

export interface WhatsNewAccentColor {
  hex: string
  textColor: '#ffffff'
}

export interface WhatsNewNotificationDelivery {
  digest: string
  deliveredAt: number
}

export interface WhatsNewNotificationState {
  lastSeenDigest?: string
  deliveries: WhatsNewNotificationDelivery[]
}

export interface ShouldNotifyWhatsNewInput {
  digest: string
  now: number
  state: WhatsNewNotificationState
  maxPerDay?: number
}

const USER_VISIBLE_PREFIXES = new Set(['feat', 'fix', 'perf', 'security', 'docs'])
const FALLBACK_SUMMARY = 'This update improves the writing workflow and fixes issues from recent builds.'

export function buildWhatsNewDraft(input: BuildWhatsNewDraftInput): WhatsNewDraft {
  const userVisibleCommits = input.commits.filter(isUserVisibleCommit)
  const lines = userVisibleCommits.length > 0
    ? userVisibleCommits.map((commit) => `- ${humanizeCommitSubject(commit.subject)}`)
    : ['- General reliability improvements and release maintenance.']
  const summary = normalizeSummary(input.aiSummary) ?? summaryFromLines(lines)
  const markdown = [
    `# v${input.version}`,
    '',
    summary,
    '',
    '## Highlights',
    '',
    ...lines,
    '',
  ].join('\n')
  const digest = createWhatsNewDigest(markdown)
  const accent = deriveWhatsNewAccentColor(digest)

  return {
    markdown,
    manifest: {
      version: input.version,
      digest,
      generatedAt: input.generatedAt,
      title: `Storyflow v${input.version} 更新说明`,
      summary,
      highlights: extractWhatsNewHighlights(markdown),
      accentColor: accent.hex,
      accentTextColor: accent.textColor,
      source: {
        commitCount: input.commits.length,
        userVisibleCommitCount: userVisibleCommits.length,
      },
    },
  }
}

export function createWhatsNewDigest(markdown: string): string {
  return createHash('sha256').update(markdown.trim(), 'utf8').digest('hex')
}

export function extractWhatsNewHighlights(markdown: string, limit = 4): string[] {
  const seen = new Set<string>()
  const highlights: string[] = []

  for (const line of markdown.split('\n')) {
    const match = line.trim().match(/^[-*]\s+(.+)$/)
    if (!match?.[1]) continue

    const item = normalizeHighlight(match[1])
    if (!item || seen.has(item)) continue

    seen.add(item)
    highlights.push(item)
    if (highlights.length >= limit) break
  }

  return highlights
}

export function deriveWhatsNewAccentColor(seed: string): WhatsNewAccentColor {
  const hash = /^[0-9a-f]+$/i.test(seed)
    ? seed.toLowerCase()
    : createWhatsNewDigest(seed)
  const hue = parseInt(hash.slice(0, 8), 16) % 360
  const saturation = 72

  for (let lightness = 40; lightness >= 18; lightness -= 2) {
    const hex = hslToHex(hue, saturation, lightness)
    if (contrastRatio(hex, '#ffffff') >= 4.5) {
      return { hex, textColor: '#ffffff' }
    }
  }

  return { hex: '#1f2937', textColor: '#ffffff' }
}

export function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(hexToRgb(foreground))
  const bg = relativeLuminance(hexToRgb(background))
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return (lighter + 0.05) / (darker + 0.05)
}

export function shouldNotifyWhatsNew(input: ShouldNotifyWhatsNewInput): {
  shouldNotify: boolean
  nextState: WhatsNewNotificationState
} {
  if (!input.digest || input.state.lastSeenDigest === input.digest) {
    return { shouldNotify: false, nextState: normalizeNotificationState(input.state) }
  }

  const maxPerDay = input.maxPerDay ?? 2
  const dayKey = localDayKey(input.now)
  const todaysDeliveries = input.state.deliveries.filter((delivery) => localDayKey(delivery.deliveredAt) === dayKey)
  const alreadyDelivered = todaysDeliveries.some((delivery) => delivery.digest === input.digest)

  if (alreadyDelivered || todaysDeliveries.length >= maxPerDay) {
    return { shouldNotify: false, nextState: normalizeNotificationState(input.state) }
  }

  return {
    shouldNotify: true,
    nextState: normalizeNotificationState({
      ...input.state,
      deliveries: [
        ...todaysDeliveries,
        { digest: input.digest, deliveredAt: input.now },
      ],
    }),
  }
}

export function isUserVisibleCommit(commit: WhatsNewCommit): boolean {
  const match = commit.subject.match(/^([a-z]+)(?:\([^)]+\))?!?:\s+(.+)$/i)
  if (!match) return false
  const prefix = match[1]
  if (!prefix) return false
  return USER_VISIBLE_PREFIXES.has(prefix.toLowerCase())
}

function humanizeCommitSubject(subject: string): string {
  const match = subject.match(/^([a-z]+)(?:\([^)]+\))?!?:\s+(.+)$/i)
  const prefix = match?.[1]?.toLowerCase()
  let stripped = (match?.[2] ?? subject).trim()
  if (prefix === 'feat') {
    stripped = stripped.replace(/^(?:add|adds|added|introduce|introduces|introduced)\s+/i, '')
  }
  if (!stripped) return subject
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

function normalizeSummary(summary: string | undefined): string | undefined {
  const trimmed = summary?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\s+/g, ' ')
}

function normalizeHighlight(markdown: string): string {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function summaryFromLines(lines: string[]): string {
  if (lines.length === 0) return FALLBACK_SUMMARY
  const first = lines[0]?.replace(/^-\s+/, '').trim()
  if (!first || first.startsWith('General reliability')) return FALLBACK_SUMMARY
  return `This update adds ${first.charAt(0).toLowerCase()}${first.slice(1)}.`
}

function normalizeNotificationState(state: WhatsNewNotificationState): WhatsNewNotificationState {
  return {
    lastSeenDigest: state.lastSeenDigest,
    deliveries: state.deliveries.slice(-20),
  }
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100
  const l = lightness / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0

  if (hue < 60) {
    r = c
    g = x
  } else if (hue < 120) {
    r = x
    g = c
  } else if (hue < 180) {
    g = c
    b = x
  } else if (hue < 240) {
    g = x
    b = c
  } else if (hue < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  return rgbToHex({
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  })
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`)
  }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  }
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  })
  const r = channels[0] ?? 0
  const g = channels[1] ?? 0
  const b = channels[2] ?? 0
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
