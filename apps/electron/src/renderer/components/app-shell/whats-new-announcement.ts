// input: What's New manifest and local last-seen release markers
// output: Startup announcement decisions and short user-facing copy
// pos: Pure renderer policy for app-update announcements before AppShell side effects

import type { WhatsNewManifest } from '../../../shared/types'

interface WhatsNewStartupActionInput {
  manifest: WhatsNewManifest
  lastSeenDigest: string
  lastSeenVersion: string
}

export interface WhatsNewStartupAction {
  shouldOpenDialog: boolean
  hasUnseenReleaseNotes: boolean
}

export interface WhatsNewAnnouncementCopy {
  title: string
  versionLabel: string
  summary: string
  guideItems: string[]
  primaryActionLabel: string
  secondaryActionLabel: string
}

const DEFAULT_SUMMARY = '这一版优化了写作体验，并修复了近期反馈的问题。'
const MAX_SUMMARY_LENGTH = 96
const MAX_GUIDE_ITEM_LENGTH = 72

export function getWhatsNewStartupAction(input: WhatsNewStartupActionInput): WhatsNewStartupAction {
  const hasUnseenReleaseNotes = input.lastSeenDigest
    ? input.lastSeenDigest !== input.manifest.digest
    : input.lastSeenVersion !== input.manifest.version

  return {
    shouldOpenDialog: hasUnseenReleaseNotes,
    hasUnseenReleaseNotes,
  }
}

export function buildWhatsNewAnnouncementCopy(manifest: WhatsNewManifest): WhatsNewAnnouncementCopy {
  return {
    title: 'Storyflow 更新好了',
    versionLabel: `v${manifest.version}`,
    summary: truncateSummary(normalizeSummary(manifest.summary)),
    guideItems: normalizeGuideItems(manifest.highlights ?? []),
    primaryActionLabel: '继续使用',
    secondaryActionLabel: '查看全部更新',
  }
}

function normalizeSummary(summary: string): string {
  const cleaned = summary
    .replace(/^#+\s*/g, '')
    .replace(/^[-*]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || DEFAULT_SUMMARY
}

function truncateSummary(summary: string): string {
  if (summary.length <= MAX_SUMMARY_LENGTH) return summary
  return `${summary.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`
}

function normalizeGuideItems(items: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const item of items) {
    const text = item.replace(/\s+/g, ' ').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    normalized.push(truncateGuideItem(text))
    if (normalized.length >= 4) break
  }

  return normalized
}

function truncateGuideItem(item: string): string {
  if (item.length <= MAX_GUIDE_ITEM_LENGTH) return item
  return `${item.slice(0, MAX_GUIDE_ITEM_LENGTH - 1).trimEnd()}…`
}
