// input: workspace project metadata for a new conversation panel
// output: regression coverage for template-aware chat opening prompts
// pos: protects the empty-session opening contract shown before the first user message

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

import { resolveChatOpeningPrompt } from '../chat-opening'

const chatDisplaySource = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf8')
const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const chatPageSource = readFileSync(new URL('../../../pages/ChatPage.tsx', import.meta.url), 'utf8')
const zhHansLocale = JSON.parse(readFileSync(new URL('../../../../../../../packages/shared/src/i18n/locales/zh-Hans.json', import.meta.url), 'utf8'))

describe('resolveChatOpeningPrompt', () => {
  it('uses a general opening when the workspace has no writing method pack', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: 'Craft Agents',
      projectType: 'general',
    })

    expect(opening.titleKey).toBe('chatOpening.general.title')
    expect(opening.workspaceName).toBe('Craft Agents')
    expect(opening.methodPackName).toBeUndefined()
    expect(opening.actions.map(action => action.id)).toEqual([
      'general.analyze',
      'general.fix',
      'general.implement',
      'general.summarize',
    ])
    expect(opening.sections.map(section => section.id)).toEqual([
      'project',
      'sources',
      'tools',
    ])
    expect(opening.sections.find(section => section.id === 'tools')?.actions.map(action => action.id)).toEqual([
      'tools.tutorial',
      'tools.skill',
      'tools.inspect',
    ])
  })

  it('uses Method Pack specific copy and starters for writing workspaces', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '九州小说',
      projectType: 'novel',
      methodPackId: 'novel.free-creation',
    })

    expect(opening.titleKey).toBe('chatOpening.freeCreation.title')
    expect(opening.workspaceName).toBe('九州小说')
    expect(opening.methodPackName).toBe('自由创作')
    expect(opening.actions.map(action => action.id)).toEqual([
      'freeCreation.continue',
      'freeCreation.materials',
      'freeCreation.idea',
      'freeCreation.review',
    ])
    expect(opening.sections.map(section => section.id)).toEqual([
      'writing',
      'sources',
      'tools',
    ])
  })

  it('uses high-frequency short-form skill actions for short webnovel projects', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '她割肾供出的水厂，热浪中先渴死了她自己',
      projectType: 'short-form',
      methodPackId: 'short-form.article',
    })

    expect(opening.titleKey).toBe('chatOpening.shortForm.title')
    expect(opening.actions.map(action => action.id)).toEqual([
      'shortForm.goldenThree',
      'shortForm.draftChapter',
      'shortForm.revise',
      'shortForm.opening',
    ])
  })

  it('adds an inspiration exploration starter backed by Wangwen BigData', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '短篇项目',
      projectType: 'short-form',
      methodPackId: 'short-form.article',
    })
    const sourceActions = opening.sections.find(section => section.id === 'sources')?.actions ?? []

    expect(sourceActions.map(action => action.id)).toEqual([
      'sources.inspiration',
      'sources.collect',
      'sources.compare',
    ])
    expect(zhHansLocale['chatOpening.sources.inspiration.label']).toBe('灵感探索')
    expect(zhHansLocale['chatOpening.sources.inspiration.desc']).toBe('近一周新秀榜')
    expect(zhHansLocale['chatOpening.sources.inspiration.prompt']).toContain('[source:wangwen-bigdata]')
    expect(zhHansLocale['chatOpening.sources.inspiration.prompt']).toContain('近一周')
    expect(zhHansLocale['chatOpening.sources.inspiration.prompt']).toContain('新秀榜')
  })

  it('keeps unknown writing Method Pack ids on writing actions instead of falling back to generic project buttons', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '短篇项目',
      methodPackId: 'short-form.custom',
    })

    expect(opening.actions.map(action => action.id)).toEqual([
      'shortForm.goldenThree',
      'shortForm.draftChapter',
      'shortForm.revise',
      'shortForm.opening',
    ])
  })

  it('falls back to project-type copy when the method pack is unknown', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '剧本项目',
      projectType: 'screenplay',
      methodPackId: 'unknown.pack',
    })

    expect(opening.titleKey).toBe('chatOpening.screenplay.title')
    expect(opening.workspaceName).toBe('剧本项目')
    expect(opening.methodPackName).toBeUndefined()
    expect(opening.actions[0]?.id).toBe('screenplay.logic')
  })

  it('renders the opening contract in the normal empty chat state', () => {
    expect(chatDisplaySource).toContain('resolveChatOpeningPrompt')
    expect(chatDisplaySource).toContain('turns.length === 0')
    expect(chatDisplaySource).toContain('handleOpeningAction')
    expect(chatDisplaySource).toContain('onInputChange?.(prompt)')
    expect(chatDisplaySource).toContain('opening.sections.map')
    expect(chatDisplaySource).toContain('action.descriptionKey')
  })

  it('keeps guided start copy concise', () => {
    const opening = resolveChatOpeningPrompt({
      workspaceName: '短篇项目',
      projectType: 'short-form',
      methodPackId: 'short-form.article',
    })
    const allActions = opening.sections.flatMap(section => section.actions)

    expect(allActions).toHaveLength(10)
    for (const action of allActions) {
      expect(zhHansLocale[action.labelKey].length).toBeLessThanOrEqual(8)
      expect(zhHansLocale[action.descriptionKey].length).toBeLessThanOrEqual(14)
    }
  })

  it('uses normalized AppShell opening metadata before raw workspace metadata', () => {
    expect(chatPageSource).toContain('projectType: openingProjectMetadata?.projectType ?? chatWorkspace?.projectType')
    expect(chatPageSource).toContain('methodPackId: openingProjectMetadata?.methodPackId ?? chatWorkspace?.methodPackId')
    expect(chatPageSource).toContain('chatOpening={chatOpening}')
    expect(chatDisplaySource).not.toContain('openingProjectMetadata')
  })

  it('derives short-form opening metadata from detected writing workspace files', () => {
    expect(appShellSource).toContain('const openingProjectMetadata = React.useMemo<WorkspaceOpeningMetadata | undefined>')
    expect(appShellSource).toContain('if (showNovelWorkspaceSidebar && isShortFormNovelWorkspace)')
    expect(appShellSource).toContain("methodPackId: 'short-form.article'")
    expect(appShellSource).toContain('openingProjectMetadata,')
  })
})
