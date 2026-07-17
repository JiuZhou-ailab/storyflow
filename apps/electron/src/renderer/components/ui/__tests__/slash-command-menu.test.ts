import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { LoadedSkill } from '../../../../shared/types'
import type { SlashSection } from '../slash-command-menu'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let createSlashSkillItems: typeof import('../slash-command-menu').createSlashSkillItems
let createSlashFolderItems: typeof import('../slash-command-menu').createSlashFolderItems
let hasMatchingSlashItems: typeof import('../slash-command-menu').hasMatchingSlashItems
let getSlashSkillInsertionText: typeof import('../slash-command-menu').getSlashSkillInsertionText
let parseInlineSlashCommandQuery: typeof import('../slash-command-menu').parseInlineSlashCommandQuery

beforeAll(async () => {
  const mod = await import('../slash-command-menu')
  createSlashSkillItems = mod.createSlashSkillItems
  createSlashFolderItems = mod.createSlashFolderItems
  hasMatchingSlashItems = mod.hasMatchingSlashItems
  getSlashSkillInsertionText = mod.getSlashSkillInsertionText
  parseInlineSlashCommandQuery = mod.parseInlineSlashCommandQuery
})

function skill(overrides: Partial<LoadedSkill> & Pick<LoadedSkill, 'slug'>): LoadedSkill {
  return {
    slug: overrides.slug,
    metadata: {
      name: overrides.metadata?.name ?? overrides.slug,
      description: overrides.metadata?.description ?? '',
    },
    content: '',
    path: overrides.path ?? `/skills/${overrides.slug}`,
    iconPath: overrides.iconPath,
  }
}

describe('slash skill commands', () => {
  it('maps skills into slash command items', () => {
    const items = createSlashSkillItems([
      skill({
        slug: 'review-pr',
        metadata: {
          name: 'Review PR',
          description: 'Review the current pull request',
        },
      }),
    ])

    expect(items).toEqual([
      {
        id: 'review-pr',
        type: 'skill',
        label: 'Review PR',
        description: 'Review the current pull request',
        searchText: 'review pr review-pr review the current pull request',
        skill: items[0]!.skill,
      },
    ])
  })

  it('inserts selected skills as existing skill mention tokens', () => {
    expect(getSlashSkillInsertionText(skill({ slug: 'review-pr' }), 'craft-agents')).toBe('[skill:craft-agents:review-pr] ')
  })

  it('keeps every Skill scoped to the current Storyflow project', () => {
    expect(getSlashSkillInsertionText(skill({ slug: 'debug' }), 'craft-agents')).toBe('[skill:craft-agents:debug] ')
  })

  it('keeps hyphenated skill names in the slash query', () => {
    expect(parseInlineSlashCommandQuery('/review-pr')).toEqual({ start: 0, filter: 'review-pr' })
    expect(parseInlineSlashCommandQuery('please /review-pr')).toEqual({ start: 7, filter: 'review-pr' })
  })

  it('builds sorted folder items from precomputed folder display data', () => {
    const items = createSlashFolderItems([
      '/Users/zjding/work/beta',
      '/Users/zjding/work/Alpha',
      '/tmp/zeta',
    ], '/Users/zjding')

    expect(items.map(item => item.label)).toEqual(['Alpha', 'beta', 'zeta'])
    expect(items.map(item => item.description)).toEqual([
      '~/work/Alpha',
      '~/work/beta',
      '/tmp/zeta',
    ])
    expect(items.find(item => item.label === 'Alpha')?.searchText).toBe('alpha /users/zjding/work/alpha ~/work/alpha')
  })

  it('checks whether slash sections contain a filter match without rebuilding sections', () => {
    const sections: SlashSection[] = [
      {
        id: 'commands',
        label: 'Commands',
        items: [
          {
            id: 'compact',
            label: 'Compact Context',
            description: 'Summarize conversation context',
            icon: null,
          },
        ],
      },
      {
        id: 'folders',
        label: 'Folders',
        items: createSlashFolderItems(['/Users/zjding/work/Alpha'], '/Users/zjding'),
      },
    ]

    expect(hasMatchingSlashItems(sections, '')).toBe(true)
    expect(hasMatchingSlashItems(sections, 'alp')).toBe(true)
    expect(hasMatchingSlashItems(sections, '~/work')).toBe(true)
    expect(hasMatchingSlashItems(sections, 'missing')).toBe(false)
  })

  it('memoizes inline slash filtering and flattening in the menu render path', () => {
    const source = readFileSync(new URL('../slash-command-menu.tsx', import.meta.url), 'utf-8')

    expect(source).toContain('const filteredSections = React.useMemo(')
    expect(source).toContain('() => filterSections(sections, filter)')
    expect(source).toContain('[sections, filter]')
    expect(source).toContain('const flatItems = React.useMemo(')
    expect(source).toContain('() => flattenSections(filteredSections)')
    expect(source).toContain('[filteredSections]')
    expect(source).not.toContain('const filteredSections = filterSections(sections, filter)')
    expect(source).not.toContain('const flatItems = flattenSections(filteredSections)')
  })

  it('precomputes slash item search text for inline menu filtering', () => {
    const source = readFileSync(new URL('../slash-command-menu.tsx', import.meta.url), 'utf-8')
    const matcherStart = source.indexOf('function slashItemMatchesFilter')
    const matcherEnd = source.indexOf('export function hasMatchingSlashItems', matcherStart)
    const matcherSource = source.slice(matcherStart, matcherEnd)

    expect(source).toContain('searchText: buildSlashItemSearchText(')
    expect(matcherSource).toContain('if (item.searchText) return item.searchText.includes(lowerFilter)')
    expect(matcherSource).not.toContain('item.label.toLowerCase().includes(lowerFilter)')
  })
})
