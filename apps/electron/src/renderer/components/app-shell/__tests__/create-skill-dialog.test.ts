// input: CreateSkillDialog pure helpers
// output: Regression for slugify + SKILL.md scaffold shape
// pos: Keeps direct skill create independent of AI EditPopover

import { describe, expect, it } from 'bun:test'
import { buildSkillMarkdown, toSkillSlug } from '../CreateSkillDialog'

describe('toSkillSlug', () => {
  it('normalizes display names to Agent Skills slugs', () => {
    expect(toSkillSlug('Chapter Continuity')).toBe('chapter-continuity')
    expect(toSkillSlug('  Review PRs!! ')).toBe('review-prs')
  })

  it('returns empty for pure CJK so the dialog can fall back', () => {
    expect(toSkillSlug('章节衔接检查')).toBe('')
  })
})

describe('buildSkillMarkdown', () => {
  it('emits frontmatter where name matches the directory slug', () => {
    const md = buildSkillMarkdown({
      slug: 'chapter-continuity',
      displayName: '章节衔接检查',
      description: '检查相邻章节是否自然承接',
    })
    expect(md).toContain('name: chapter-continuity')
    expect(md).toContain('displayName: "章节衔接检查"')
    expect(md).toContain('description: "检查相邻章节是否自然承接"')
    expect(md).toContain('# 章节衔接检查')
  })
})
