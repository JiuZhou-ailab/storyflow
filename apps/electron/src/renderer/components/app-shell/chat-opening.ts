// input: workspace project metadata for an empty chat session
// output: unified opening prompt copy and starter actions
// pos: product contract for the main chat empty state

import {
  getBuiltInMethodPack,
  type MethodPackId,
} from '@craft-agent/shared/writing/method-packs'
import type { WorkspaceProjectType } from '../../../shared/types'

export interface ChatOpeningAction {
  id: string
  labelKey: string
  descriptionKey: string
  promptKey: string
}

export interface ChatOpeningSection {
  id: 'project' | 'writing' | 'sources' | 'tools'
  labelKey: string
  actions: ChatOpeningAction[]
}

export interface ChatOpeningPrompt {
  titleKey: string
  workspaceName?: string
  methodPackName?: string
  hintKey: string
  sections: ChatOpeningSection[]
  actions: ChatOpeningAction[]
}

export interface ResolveChatOpeningPromptInput {
  workspaceName?: string
  projectType?: WorkspaceProjectType
  methodPackId?: string
}

interface OpeningPreset {
  titleKey: string
  primarySection: ChatOpeningSection
  actions: ChatOpeningAction[]
}

function starterAction(id: string): ChatOpeningAction {
  const keyPrefix = `chatOpening.${id}`
  return {
    id,
    labelKey: `${keyPrefix}.label`,
    descriptionKey: `${keyPrefix}.desc`,
    promptKey: `${keyPrefix}.prompt`,
  }
}

const GENERAL_ACTIONS: ChatOpeningAction[] = [
  starterAction('general.analyze'),
  starterAction('general.fix'),
  starterAction('general.implement'),
  starterAction('general.summarize'),
]

const GENERAL_OPENING: OpeningPreset = {
  titleKey: 'chatOpening.general.title',
  primarySection: {
    id: 'project',
    labelKey: 'chatOpening.section.project',
    actions: GENERAL_ACTIONS,
  },
  actions: GENERAL_ACTIONS,
}

const SHORT_FORM_SKILL_ACTIONS: ChatOpeningAction[] = [
  starterAction('shortForm.goldenThree'),
  starterAction('shortForm.draftChapter'),
  starterAction('shortForm.revise'),
  starterAction('shortForm.opening'),
]

const SOURCE_SECTION: ChatOpeningSection = {
  id: 'sources',
  labelKey: 'chatOpening.section.sources',
  actions: [
    starterAction('sources.collect'),
    starterAction('sources.compare'),
  ],
}

const TOOL_SECTION: ChatOpeningSection = {
  id: 'tools',
  labelKey: 'chatOpening.section.tools',
  actions: [
    starterAction('tools.tutorial'),
    starterAction('tools.skill'),
    starterAction('tools.inspect'),
  ],
}

function createWritingPreset(titleKey: string, actions: ChatOpeningAction[]): OpeningPreset {
  return {
    titleKey,
    primarySection: {
      id: 'writing',
      labelKey: 'chatOpening.section.writing',
      actions,
    },
    actions,
  }
}

const PROJECT_TYPE_OPENINGS: Record<WorkspaceProjectType, OpeningPreset> = {
  general: GENERAL_OPENING,
  novel: createWritingPreset('chatOpening.novel.title', [
    starterAction('novel.continue'),
    starterAction('novel.causality'),
    starterAction('novel.characters'),
    starterAction('novel.outline'),
  ]),
  screenplay: createWritingPreset('chatOpening.screenplay.title', [
    starterAction('screenplay.logic'),
    starterAction('screenplay.scene'),
    starterAction('screenplay.motivation'),
    starterAction('screenplay.sceneList'),
  ]),
  'short-form': createWritingPreset('chatOpening.shortForm.title', SHORT_FORM_SKILL_ACTIONS),
}

const METHOD_PACK_OPENINGS: Partial<Record<MethodPackId, OpeningPreset>> = {
  'novel.claude-book': createWritingPreset('chatOpening.longForm.title', PROJECT_TYPE_OPENINGS.novel.actions),
  'screenplay.logic': PROJECT_TYPE_OPENINGS.screenplay,
  'novel.free-creation': createWritingPreset('chatOpening.freeCreation.title', [
    starterAction('freeCreation.continue'),
    starterAction('freeCreation.materials'),
    starterAction('freeCreation.idea'),
    starterAction('freeCreation.review'),
  ]),
  'short-form.article': PROJECT_TYPE_OPENINGS['short-form'],
}

function normalizeProjectType(projectType: WorkspaceProjectType | undefined): WorkspaceProjectType {
  return projectType === 'novel' || projectType === 'screenplay' || projectType === 'short-form'
    ? projectType
    : 'general'
}

function resolvePresetFromMethodPackPrefix(methodPackId: string | undefined): OpeningPreset | null {
  if (!methodPackId) return null
  if (methodPackId.startsWith('short-form.')) return PROJECT_TYPE_OPENINGS['short-form']
  if (methodPackId.startsWith('novel.')) return PROJECT_TYPE_OPENINGS.novel
  if (methodPackId.startsWith('screenplay.')) return PROJECT_TYPE_OPENINGS.screenplay
  return null
}

function resolveOpeningPreset(
  methodPackId: string | undefined,
  projectType: WorkspaceProjectType | undefined,
): OpeningPreset {
  const methodPack = methodPackId ? getBuiltInMethodPack(methodPackId) : null
  if (methodPack) {
    return METHOD_PACK_OPENINGS[methodPack.id] ?? PROJECT_TYPE_OPENINGS[methodPack.projectType]
  }

  return resolvePresetFromMethodPackPrefix(methodPackId)
    ?? PROJECT_TYPE_OPENINGS[normalizeProjectType(projectType)]
}

export function resolveChatOpeningPrompt({
  workspaceName,
  projectType,
  methodPackId,
}: ResolveChatOpeningPromptInput): ChatOpeningPrompt {
  const methodPack = methodPackId ? getBuiltInMethodPack(methodPackId) : null
  const preset = resolveOpeningPreset(methodPackId, projectType)
  return {
    titleKey: preset.titleKey,
    workspaceName: workspaceName?.trim() || undefined,
    methodPackName: methodPack?.displayName,
    hintKey: 'chatOpening.hint',
    sections: [preset.primarySection, SOURCE_SECTION, TOOL_SECTION],
    actions: preset.actions,
  }
}
