// input: Project content state for a new conversation panel
// output: Regression coverage for folder-first chat opening commands
// pos: Protects the empty-session opening contract shown before the first user message

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

import { resolveChatOpeningPrompt } from '../chat-opening'

const zhHansLocale = JSON.parse(readFileSync(new URL('../../../../../../../packages/shared/src/i18n/locales/zh-Hans.json', import.meta.url), 'utf8'))

describe('resolveChatOpeningPrompt', () => {
  it('offers a content-empty project three real ways to begin', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '空白作品',
      isProject: true,
      hasUserContent: false,
    })

    expect(opening.titleKey).toBe('chatOpening.project.emptyTitle')
    expect(opening.hintKey).toBe('chatOpening.project.emptyHint')
    expect(opening.workspaceName).toBe('空白作品')
    expect(opening.sections.map(section => section.id)).toEqual(['project'])
    expect(opening.actions.map(action => ({
      id: action.id,
      command: action.command,
    }))).toEqual([
      { id: 'project.import', command: 'import-files' },
      { id: 'project.createFile', command: 'create-file' },
      { id: 'project.skills', command: 'open-skills' },
    ])
  })

  it('derives a ready project opening from real content instead of project metadata', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '已有作品',
      isProject: true,
      hasUserContent: true,
    })

    expect(opening.titleKey).toBe('chatOpening.project.readyTitle')
    expect(opening.hintKey).toBe('chatOpening.project.readyHint')
    expect(opening.actions.map(action => action.id)).toEqual([
      'project.import',
      'project.createFile',
      'project.skills',
    ])
  })

  it('keeps free conversations independent from project file actions', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '自由对话',
      isProject: false,
      hasUserContent: false,
    })

    expect(opening.titleKey).toBe('chatOpening.general.title')
    expect(opening.sections).toEqual([])
    expect(opening.actions).toEqual([])
  })

  it('keeps project starter labels and descriptions concise', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '空白作品',
      isProject: true,
      hasUserContent: false,
    })

    for (const action of opening.actions) {
      expect(zhHansLocale[action.labelKey].length).toBeLessThanOrEqual(8)
      expect(zhHansLocale[action.descriptionKey].length).toBeLessThanOrEqual(14)
    }
  })
})
