import { beforeAll, describe, expect, it, mock } from 'bun:test'
import type { LoadedSkill } from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let createSlashSkillItems: typeof import('../slash-command-menu').createSlashSkillItems
let getSlashSkillInsertionText: typeof import('../slash-command-menu').getSlashSkillInsertionText
let parseInlineSlashCommandQuery: typeof import('../slash-command-menu').parseInlineSlashCommandQuery

beforeAll(async () => {
  const mod = await import('../slash-command-menu')
  createSlashSkillItems = mod.createSlashSkillItems
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
    source: overrides.source ?? 'workspace',
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
        skill: items[0]!.skill,
      },
    ])
  })

  it('inserts selected skills as existing skill mention tokens', () => {
    expect(getSlashSkillInsertionText(skill({ slug: 'review-pr' }), 'craft-agents')).toBe('[skill:craft-agents:review-pr] ')
  })

  it('qualifies bundled skills with the agents plugin name', () => {
    expect(getSlashSkillInsertionText(skill({ slug: 'debug', source: 'global' }), 'craft-agents')).toBe('[skill:.agents:debug] ')
  })

  it('keeps hyphenated skill names in the slash query', () => {
    expect(parseInlineSlashCommandQuery('/review-pr')).toEqual({ start: 0, filter: 'review-pr' })
    expect(parseInlineSlashCommandQuery('please /review-pr')).toEqual({ start: 7, filter: 'review-pr' })
  })
})
