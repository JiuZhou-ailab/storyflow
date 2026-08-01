// input: What's New manifest and local last-seen release markers
// output: Regression coverage for the startup update announcement contract
// pos: Keeps app-update announcements simple, once-per-version, and separate from full release notes

import { describe, expect, it } from 'bun:test'

import {
  buildWhatsNewAnnouncementCopy,
  getWhatsNewStartupAction,
} from '../whats-new-announcement'
import type { WhatsNewManifest } from '../../../../shared/types'

const manifest: WhatsNewManifest = {
  version: '0.9.29',
  digest: 'digest-new',
  generatedAt: '2026-06-03T00:00:00.000Z',
  title: 'What is new in v0.9.29',
  summary: '这一版优化了写作工作区入口，并修复了更新后首次打开时的提示不清晰问题。',
  accentColor: '#2563eb',
  accentTextColor: '#ffffff',
  highlights: [
    '新增更新后公告弹窗',
    '优化写作工作区入口',
    '修复更新后首次打开时的提示不清晰问题',
  ],
  source: {
    commitCount: 3,
    userVisibleCommitCount: 2,
  },
}

describe('whats-new startup announcement', () => {
  it('opens the announcement dialog when the bundled update has not been seen', () => {
    const action = getWhatsNewStartupAction({
      manifest,
      lastSeenDigest: 'digest-old',
      lastSeenVersion: '0.9.28',
    })

    expect(action.shouldOpenDialog).toBe(true)
    expect(action.hasUnseenReleaseNotes).toBe(true)
  })

  it('does not reopen after the same digest has already been seen', () => {
    const action = getWhatsNewStartupAction({
      manifest,
      lastSeenDigest: 'digest-new',
      lastSeenVersion: '0.9.28',
    })

    expect(action.shouldOpenDialog).toBe(false)
    expect(action.hasUnseenReleaseNotes).toBe(false)
  })

  it('falls back to version comparison for users from older builds', () => {
    expect(getWhatsNewStartupAction({
      manifest,
      lastSeenDigest: '',
      lastSeenVersion: '0.9.28',
    }).shouldOpenDialog).toBe(true)

    expect(getWhatsNewStartupAction({
      manifest,
      lastSeenDigest: '',
      lastSeenVersion: '0.9.29',
    }).shouldOpenDialog).toBe(false)
  })

  it('uses short Chinese guide copy that explains what changed', () => {
    const copy = buildWhatsNewAnnouncementCopy(manifest)

    expect(copy.title).toBe('Storyflow 更新好了')
    expect(copy.versionLabel).toBe('v0.9.29')
    expect(copy.summary).toBe(manifest.summary)
    expect(copy.guideItems).toEqual([
      '新增更新后公告弹窗',
      '优化写作工作区入口',
      '修复更新后首次打开时的提示不清晰问题',
    ])
    expect(copy.primaryActionLabel).toBe('继续使用')
    expect(copy.secondaryActionLabel).toBe('查看全部更新')
    expect(copy.summary.length).toBeLessThanOrEqual(96)
  })
})
