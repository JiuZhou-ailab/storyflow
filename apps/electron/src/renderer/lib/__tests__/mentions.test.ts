// input: Canonical and legacy Skill mention strings plus Source fixtures
// output: Regression proof for global Skill badge writes and backward-compatible reads
// pos: Renderer mention-contract test

import { describe, it, expect } from 'bun:test'
import { parseMentions, findMentionMatches, resolveSkillMentions, resolveSourceMentions, extractBadges } from '../mentions'

// ============================================================================
// parseMentions - Skill Pattern Tests
// ============================================================================

describe('parseMentions - skill pattern with workspace IDs', () => {
  const availableSkills = ['commit', 'review-pr', 'my_skill', 'skill.name']

  describe('simple skill mentions [skill:slug]', () => {
    it('parses skill with hyphen in slug', () => {
      const result = parseMentions('[skill:review-pr]', availableSkills, [])
      expect(result.skills).toEqual(['review-pr'])
    })

    it('parses skill with underscore in slug', () => {
      const result = parseMentions('[skill:my_skill]', availableSkills, [])
      expect(result.skills).toEqual(['my_skill'])
    })

    it('parses multiple skills', () => {
      const result = parseMentions('[skill:commit] and [skill:review-pr]', availableSkills, [])
      expect(result.skills).toEqual(['commit', 'review-pr'])
    })
  })

  describe('skill mentions with workspace ID [skill:workspaceId:slug]', () => {
    it('parses skill with simple workspace ID', () => {
      const result = parseMentions('[skill:MyWorkspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing space', () => {
      const result = parseMentions('[skill:My Workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing multiple spaces', () => {
      const result = parseMentions('[skill:My Cool Workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing hyphen', () => {
      const result = parseMentions('[skill:my-workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing underscore', () => {
      const result = parseMentions('[skill:my_workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing dot', () => {
      const result = parseMentions('[skill:my.workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing mixed special chars', () => {
      const result = parseMentions('[skill:My-Cool_Workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing spaces and hyphens', () => {
      const result = parseMentions('[skill:My Cool-Workspace:review-pr]', availableSkills, [])
      expect(result.skills).toEqual(['review-pr'])
    })
  })

  describe('edge cases', () => {
    it('returns empty array for non-existent skill', () => {
      const result = parseMentions('[skill:nonexistent]', availableSkills, [])
      expect(result.skills).toEqual([])
    })

    it('does not duplicate skills when mentioned multiple times', () => {
      const result = parseMentions('[skill:commit] [skill:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skills in text with other content', () => {
      const result = parseMentions('Please run [skill:commit] after fixing the bug', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })
  })
})

// ============================================================================
// findMentionMatches - Skill Pattern Tests
// ============================================================================

describe('findMentionMatches - skill pattern with workspace IDs', () => {
  const availableSkills = ['commit', 'review-pr']

  it('finds skill with workspace ID containing space', () => {
    const matches = findMentionMatches('[skill:My Workspace:commit]', availableSkills, [])
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      type: 'skill',
      id: 'commit',
      fullMatch: '[skill:My Workspace:commit]',
    })
  })

  it('finds skill with workspace ID containing hyphen', () => {
    const matches = findMentionMatches('[skill:my-workspace:review-pr]', availableSkills, [])
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      type: 'skill',
      id: 'review-pr',
      fullMatch: '[skill:my-workspace:review-pr]',
    })
  })

  it('finds skill with workspace ID containing dot', () => {
    const matches = findMentionMatches('[skill:my.workspace:commit]', availableSkills, [])
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      type: 'skill',
      id: 'commit',
      fullMatch: '[skill:my.workspace:commit]',
    })
  })

  it('returns correct start index', () => {
    const text = 'Please use [skill:My Workspace:commit] for this'
    const matches = findMentionMatches(text, availableSkills, [])
    expect(matches[0]?.startIndex).toBe(11)
  })
})

// ============================================================================
// resolveSkillMentions - Semantic marker tests
// ============================================================================

describe('resolveSkillMentions', () => {
  const skillNames = new Map([
    ['commit', 'Git Commit'],
    ['review-pr', 'Review PR'],
  ])

  it('resolves simple skill mention with display name', () => {
    const result = resolveSkillMentions('[skill:commit] do this', skillNames)
    expect(result).toBe('[Mentioned skill: Git Commit (slug: commit)] do this')
  })

  it('resolves skill with workspace ID', () => {
    const result = resolveSkillMentions('[skill:My Workspace:commit] do this', skillNames)
    expect(result).toBe('[Mentioned skill: Git Commit (slug: commit)] do this')
  })

  it('falls back to slug when not in map', () => {
    const result = resolveSkillMentions('[skill:unknown-skill] do this', skillNames)
    expect(result).toBe('[Mentioned skill: unknown-skill (slug: unknown-skill)] do this')
  })

  it('preserves sentence structure', () => {
    const result = resolveSkillMentions('find the root cause in [skill:review-pr]', skillNames)
    expect(result).toBe('find the root cause in [Mentioned skill: Review PR (slug: review-pr)]')
  })

  it('resolves multiple skill mentions', () => {
    const result = resolveSkillMentions('[skill:commit] and [skill:review-pr]', skillNames)
    expect(result).toBe('[Mentioned skill: Git Commit (slug: commit)] and [Mentioned skill: Review PR (slug: review-pr)]')
  })

  it('leaves text without mentions unchanged', () => {
    const result = resolveSkillMentions('no mentions here', skillNames)
    expect(result).toBe('no mentions here')
  })
})

// ============================================================================
// resolveSourceMentions - Semantic marker tests
// ============================================================================

describe('resolveSourceMentions', () => {
  it('resolves source mention to semantic marker', () => {
    const result = resolveSourceMentions('[source:github] check this')
    expect(result).toBe('[Mentioned source: github] check this')
  })

  it('preserves sentence structure', () => {
    const result = resolveSourceMentions('check my emails in [source:gmail]')
    expect(result).toBe('check my emails in [Mentioned source: gmail]')
  })

  it('resolves multiple source mentions', () => {
    const result = resolveSourceMentions('[source:github] and [source:linear]')
    expect(result).toBe('[Mentioned source: github] and [Mentioned source: linear]')
  })

  it('leaves text without mentions unchanged', () => {
    const result = resolveSourceMentions('no mentions here')
    expect(result).toBe('no mentions here')
  })
})

// ============================================================================
// extractBadges - Canonical Skill Reference Tests
// ============================================================================

describe('extractBadges - global Skill references', () => {
  const mockSkills = [
    { slug: 'commit', metadata: { name: 'Commit' } },
    { slug: 'review-pr', metadata: { name: 'Review PR' } },
  ] as any[]
  const mockSources = [] as any[]

  it('stores canonical rawText without a workspace slug', () => {
    const badges = extractBadges('[skill:commit]', mockSkills, mockSources, 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.rawText).toBe('[skill:commit]')
    expect(badges[0]!.label).toBe('Commit')
    expect(badges[0]!.type).toBe('skill')
  })

  it('preserves a hyphenated global slug', () => {
    const badges = extractBadges('[skill:review-pr]', mockSkills, mockSources, 'my-workspace')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.rawText).toBe('[skill:review-pr]')
    expect(badges[0]!.label).toBe('Review PR')
  })

  it('canonicalizes a legacy workspace-qualified Skill mention', () => {
    const badges = extractBadges('[skill:other-ws:commit]', mockSkills, mockSources, 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.rawText).toBe('[skill:commit]')
  })

  it('does not modify source rawText', () => {
    const sources = [{ config: { slug: 'linear', name: 'Linear' } }] as any[]
    const badges = extractBadges('[source:linear]', [], sources, 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.rawText).toBe('[source:linear]')
    expect(badges[0]!.type).toBe('source')
  })
})
