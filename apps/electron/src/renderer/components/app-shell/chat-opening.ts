// input: Workspace identity and real project content state for an empty chat session
// output: Folder-first opening copy plus prompt or workspace commands
// pos: Product contract for the main chat empty state

export type ChatOpeningCommand = 'import-files' | 'create-file' | 'open-skills'

interface ChatOpeningActionBase {
  id: string
  labelKey: string
  descriptionKey: string
}

export interface ChatOpeningPromptAction extends ChatOpeningActionBase {
  kind: 'prompt'
  promptKey: string
}

export interface ChatOpeningCommandAction extends ChatOpeningActionBase {
  kind: 'command'
  command: ChatOpeningCommand
}

export type ChatOpeningAction = ChatOpeningPromptAction | ChatOpeningCommandAction

export interface ChatOpeningSection {
  id: 'project'
  labelKey: string
  actions: ChatOpeningAction[]
}

export interface ChatOpeningPrompt {
  titleKey: string
  workspaceName?: string
  hintKey: string
  sections: ChatOpeningSection[]
  actions: ChatOpeningAction[]
}

export interface ResolveChatOpeningPromptInput {
  workspaceName?: string
  isProject?: boolean
  hasUserContent?: boolean
}

function promptAction(id: string): ChatOpeningPromptAction {
  const keyPrefix = `chatOpening.${id}`
  return {
    id,
    kind: 'prompt',
    labelKey: `${keyPrefix}.label`,
    descriptionKey: `${keyPrefix}.desc`,
    promptKey: `${keyPrefix}.prompt`,
  }
}

function commandAction(
  id: string,
  command: ChatOpeningCommand,
): ChatOpeningCommandAction {
  const keyPrefix = `chatOpening.${id}`
  return {
    id,
    kind: 'command',
    command,
    labelKey: `${keyPrefix}.label`,
    descriptionKey: `${keyPrefix}.desc`,
  }
}

const GENERAL_ACTIONS: ChatOpeningAction[] = [
  promptAction('general.analyze'),
  promptAction('general.fix'),
  promptAction('general.implement'),
  promptAction('general.summarize'),
]

const PROJECT_ACTIONS: ChatOpeningAction[] = [
  promptAction('project.describe'),
  commandAction('project.import', 'import-files'),
  commandAction('project.createFile', 'create-file'),
  commandAction('project.skills', 'open-skills'),
]

export function resolveChatOpeningPrompt({
  workspaceName,
  isProject = false,
  hasUserContent = false,
}: ResolveChatOpeningPromptInput): ChatOpeningPrompt {
  const actions = isProject ? PROJECT_ACTIONS : GENERAL_ACTIONS

  return {
    titleKey: isProject
      ? hasUserContent
        ? 'chatOpening.project.readyTitle'
        : 'chatOpening.project.emptyTitle'
      : 'chatOpening.general.title',
    workspaceName: workspaceName?.trim() || undefined,
    hintKey: isProject
      ? hasUserContent
        ? 'chatOpening.project.readyHint'
        : 'chatOpening.project.emptyHint'
      : 'chatOpening.hint',
    sections: [{
      id: 'project',
      labelKey: 'chatOpening.section.project',
      actions,
    }],
    actions,
  }
}
