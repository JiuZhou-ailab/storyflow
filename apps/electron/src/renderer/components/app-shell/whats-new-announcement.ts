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
  summary: string
  primaryActionLabel: string
  secondaryActionLabel: string
}

const DEFAULT_SUMMARY = '这一版优化了写作体验，并修复了近期反馈的问题。'
const MAX_SUMMARY_LENGTH = 96

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
    title: `已更新到 v${manifest.version}`,
    summary: truncateSummary(normalizeSummary(manifest.summary)),
    primaryActionLabel: '知道了',
    secondaryActionLabel: '查看完整更新',
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
