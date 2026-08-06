// input: Release commit metadata and local notification state samples
// output: Regression coverage for generated What's New manifests and display policy
// pos: Guards the release-time update summary contract shared by CI and desktop UI

import { describe, expect, it } from 'bun:test'
import {
  buildWhatsNewDraft,
  contrastRatio,
  createWhatsNewDigest,
  deriveWhatsNewAccentColor,
  extractWhatsNewHighlights,
  shouldNotifyWhatsNew,
} from './whats-new'

describe('buildWhatsNewDraft', () => {
  it('keeps user-visible feature, fix, and documentation commits while excluding release plumbing', () => {
    const draft = buildWhatsNewDraft({
      version: '0.9.26',
      generatedAt: '2026-06-01T00:00:00.000Z',
      commits: [
        { hash: 'a'.repeat(40), subject: 'feat: add project profile setup before opening workspace' },
        { hash: 'b'.repeat(40), subject: 'fix: keep queued message visible after redirect' },
        { hash: 'd'.repeat(40), subject: 'docs: update the beginner guide for project profiles' },
        { hash: 'c'.repeat(40), subject: 'chore: update release workflow cache key' },
      ],
    })

    expect(draft.markdown).toContain('# v0.9.26')
    expect(draft.markdown).toContain('Project profile setup before opening workspace')
    expect(draft.markdown).toContain('Keep queued message visible after redirect')
    expect(draft.markdown).toContain('Update the beginner guide for project profiles')
    expect(draft.markdown).not.toContain('release workflow cache key')
    expect(draft.manifest.version).toBe('0.9.26')
    expect(draft.manifest.digest).toBe(createWhatsNewDigest(draft.markdown))
    expect(draft.manifest.highlights).toEqual([
      'Project profile setup before opening workspace',
      'Keep queued message visible after redirect',
      'Update the beginner guide for project profiles',
    ])
  })
})

describe('extractWhatsNewHighlights', () => {
  it('returns clean user-facing bullets for the startup update guide', () => {
    expect(extractWhatsNewHighlights([
      '# v0.9.30',
      '',
      '- **新增更新指南** — 更新后首次启动直接说明重点',
      '- 修复 `DiffView` 的新增文件展示',
      '- [优化写作入口](https://example.com)',
      '- 优化写作入口',
      '- 第四个唯一要点',
      '- 第五个唯一要点不会显示',
    ].join('\n'))).toEqual([
      '新增更新指南 — 更新后首次启动直接说明重点',
      '修复 DiffView 的新增文件展示',
      '优化写作入口',
      '第四个唯一要点',
    ])
  })
})

describe('deriveWhatsNewAccentColor', () => {
  it('returns a deterministic white-text-safe accent color from update text', () => {
    const seed = createWhatsNewDigest('Important update text')
    const accent = deriveWhatsNewAccentColor(seed)

    expect(accent.hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(accent.textColor).toBe('#ffffff')
    expect(contrastRatio(accent.hex, accent.textColor)).toBeGreaterThanOrEqual(4.5)
    expect(deriveWhatsNewAccentColor(seed)).toEqual(accent)
  })
})

describe('shouldNotifyWhatsNew', () => {
  it('notifies unseen digests at most twice per local day', () => {
    const first = shouldNotifyWhatsNew({
      digest: 'digest-c',
      now: Date.UTC(2026, 5, 1, 10),
      state: {
        lastSeenDigest: 'digest-a',
        deliveries: [
          { digest: 'digest-a', deliveredAt: Date.UTC(2026, 4, 31, 10) },
          { digest: 'digest-b', deliveredAt: Date.UTC(2026, 5, 1, 8) },
        ],
      },
    })

    expect(first.shouldNotify).toBe(true)
    expect(first.nextState.deliveries).toHaveLength(2)

    const second = shouldNotifyWhatsNew({
      digest: 'digest-d',
      now: Date.UTC(2026, 5, 1, 12),
      state: first.nextState,
    })
    expect(second.shouldNotify).toBe(false)
    expect(second.nextState).toEqual(first.nextState)
  })

  it('does not notify a digest the user has already seen', () => {
    const result = shouldNotifyWhatsNew({
      digest: 'digest-a',
      now: Date.UTC(2026, 5, 1, 10),
      state: {
        lastSeenDigest: 'digest-a',
        deliveries: [],
      },
    })

    expect(result.shouldNotify).toBe(false)
    expect(result.nextState.deliveries).toEqual([])
  })
})
