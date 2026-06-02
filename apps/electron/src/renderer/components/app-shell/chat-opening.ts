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
  promptKey: string
}

export interface ChatOpeningPrompt {
  titleKey: string
  workspaceName?: string
  methodPackName?: string
  hintKey: string
  actions: ChatOpeningAction[]
}

export interface ResolveChatOpeningPromptInput {
  workspaceName?: string
  projectType?: WorkspaceProjectType
  methodPackId?: string
}

interface OpeningPreset {
  titleKey: string
  actions: ChatOpeningAction[]
}

const GENERAL_OPENING: OpeningPreset = {
  titleKey: 'chatOpening.general.title',
  actions: [
    { id: 'general.analyze', labelKey: 'chatOpening.general.analyze.label', promptKey: 'chatOpening.general.analyze.prompt' },
    { id: 'general.fix', labelKey: 'chatOpening.general.fix.label', promptKey: 'chatOpening.general.fix.prompt' },
    { id: 'general.implement', labelKey: 'chatOpening.general.implement.label', promptKey: 'chatOpening.general.implement.prompt' },
    { id: 'general.summarize', labelKey: 'chatOpening.general.summarize.label', promptKey: 'chatOpening.general.summarize.prompt' },
  ],
}

const SHORT_FORM_SKILL_ACTIONS: ChatOpeningAction[] = [
  { id: 'shortForm.goldenThree', labelKey: 'chatOpening.shortForm.goldenThree.label', promptKey: 'chatOpening.shortForm.goldenThree.prompt' },
  { id: 'shortForm.draftChapter', labelKey: 'chatOpening.shortForm.draftChapter.label', promptKey: 'chatOpening.shortForm.draftChapter.prompt' },
  { id: 'shortForm.revise', labelKey: 'chatOpening.shortForm.revise.label', promptKey: 'chatOpening.shortForm.revise.prompt' },
  { id: 'shortForm.opening', labelKey: 'chatOpening.shortForm.opening.label', promptKey: 'chatOpening.shortForm.opening.prompt' },
]

const PROJECT_TYPE_OPENINGS: Record<WorkspaceProjectType, OpeningPreset> = {
  general: GENERAL_OPENING,
  novel: {
    titleKey: 'chatOpening.novel.title',
    actions: [
      { id: 'novel.continue', labelKey: 'chatOpening.novel.continue.label', promptKey: 'chatOpening.novel.continue.prompt' },
      { id: 'novel.causality', labelKey: 'chatOpening.novel.causality.label', promptKey: 'chatOpening.novel.causality.prompt' },
      { id: 'novel.characters', labelKey: 'chatOpening.novel.characters.label', promptKey: 'chatOpening.novel.characters.prompt' },
      { id: 'novel.outline', labelKey: 'chatOpening.novel.outline.label', promptKey: 'chatOpening.novel.outline.prompt' },
    ],
  },
  screenplay: {
    titleKey: 'chatOpening.screenplay.title',
    actions: [
      { id: 'screenplay.logic', labelKey: 'chatOpening.screenplay.logic.label', promptKey: 'chatOpening.screenplay.logic.prompt' },
      { id: 'screenplay.scene', labelKey: 'chatOpening.screenplay.scene.label', promptKey: 'chatOpening.screenplay.scene.prompt' },
      { id: 'screenplay.motivation', labelKey: 'chatOpening.screenplay.motivation.label', promptKey: 'chatOpening.screenplay.motivation.prompt' },
      { id: 'screenplay.sceneList', labelKey: 'chatOpening.screenplay.sceneList.label', promptKey: 'chatOpening.screenplay.sceneList.prompt' },
    ],
  },
  'short-form': {
    titleKey: 'chatOpening.shortForm.title',
    actions: SHORT_FORM_SKILL_ACTIONS,
  },
}

const METHOD_PACK_OPENINGS: Partial<Record<MethodPackId, OpeningPreset>> = {
  'novel.claude-book': {
    titleKey: 'chatOpening.longForm.title',
    actions: PROJECT_TYPE_OPENINGS.novel.actions,
  },
  'screenplay.logic': PROJECT_TYPE_OPENINGS.screenplay,
  'novel.free-creation': {
    titleKey: 'chatOpening.freeCreation.title',
    actions: [
      { id: 'freeCreation.continue', labelKey: 'chatOpening.freeCreation.continue.label', promptKey: 'chatOpening.freeCreation.continue.prompt' },
      { id: 'freeCreation.materials', labelKey: 'chatOpening.freeCreation.materials.label', promptKey: 'chatOpening.freeCreation.materials.prompt' },
      { id: 'freeCreation.idea', labelKey: 'chatOpening.freeCreation.idea.label', promptKey: 'chatOpening.freeCreation.idea.prompt' },
      { id: 'freeCreation.review', labelKey: 'chatOpening.freeCreation.review.label', promptKey: 'chatOpening.freeCreation.review.prompt' },
    ],
  },
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
    actions: preset.actions,
  }
}
