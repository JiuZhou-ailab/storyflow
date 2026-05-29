// input: Product-level tutorial targets rendered by the app shell
// output: Ordered first-run tour copy and DOM selectors
// pos: Shared contract between tutorial tests and the guided overlay

export interface FirstRunTourStep {
  target: string
  selector: string
  title: string
  body: string
}

export const FIRST_RUN_TOUR_STEPS: FirstRunTourStep[] = [
  {
    target: 'workspace-switcher',
    selector: '[data-tutorial="workspace-switcher"]',
    title: '当前项目',
    body: '这里切换项目，也可以新建项目。你刚选择的创作逻辑会决定项目里的目录、模板和默认工作流。',
  },
  {
    target: 'writing-catalog',
    selector: '[data-tutorial="writing-catalog"]',
    title: '写作工作区',
    body: '左侧是当前项目的目录，不是普通文件浏览器。它把写作资料按工作流组织起来，方便智能体理解项目状态。',
  },
  {
    target: 'writing-global-info',
    selector: '[data-tutorial="writing-global-info"]',
    title: '全局信息',
    body: '这里放设定、人物、大纲、风格等长期有效的信息。越稳定的背景资料，越应该沉淀在这里。',
  },
  {
    target: 'writing-manuscript',
    selector: '[data-tutorial="writing-manuscript"]',
    title: '正文区',
    body: '正文文件放在这里。智能体改正文时会尽量围绕这些文件工作，并通过变更预览让你确认结果。',
  },
  {
    target: 'writing-free-area',
    selector: '[data-tutorial="writing-free-area"]',
    title: '自由区',
    body: '临时脑洞、片段、参考、未归档材料可以先放这里。等内容稳定后，再整理进全局信息或正文。',
  },
  {
    target: 'sources-nav',
    selector: '[data-tutorial="sources-nav"]',
    title: '项目资料',
    body: '资料源用于接入项目外部信息，例如文件夹、网页、知识库或服务。需要长期复用的材料优先放到资料里。',
  },
  {
    target: 'skills-nav',
    selector: '[data-tutorial="skills-nav"]',
    title: '技能',
    body: '技能是给智能体的专项工作说明。写作、审查、拆文、资料整理这类高频任务，都适合沉淀成技能。',
  },
  {
    target: 'automations-nav',
    selector: '[data-tutorial="automations-nav"]',
    title: '自动化',
    body: '自动化用来定时或按事件触发任务。适合周期检查、批量整理、状态更新这类不需要每次手动发起的工作。',
  },
  {
    target: 'settings-nav',
    selector: '[data-tutorial="settings-nav"]',
    title: '设置',
    body: '模型连接、权限、外观和工作区选项都在这里调整。遇到连接或默认模型问题，优先从设置检查。',
  },
  {
    target: 'chat-history',
    selector: '[data-tutorial="chat-history"]',
    title: '会话历史',
    body: '这里可以快速回到同一项目里的近期会话。不同会话可以服务同一个项目，但文件状态仍以项目为准。',
  },
  {
    target: 'new-session-button',
    selector: '[data-tutorial="new-session-button"]',
    title: '新建会话',
    body: '需要开启一个新任务时从这里开始。新会话会继承当前项目环境，但不会混入旧会话的聊天上下文。',
  },
  {
    target: 'permission-mode-dropdown',
    selector: '[data-tutorial="permission-mode-dropdown"]',
    title: '执行权限',
    body: '这里控制智能体能做到什么程度：只探索、改动前询问，或自动执行。重要项目建议先用需要确认的模式。',
  },
  {
    target: 'chat-input',
    selector: '[data-tutorial="chat-input"]',
    title: '给智能体下达任务',
    body: '在这里描述要做的事。可以引用文件、资料源或技能，让智能体基于项目上下文执行。',
  },
  {
    target: 'source-selector-button',
    selector: '[data-tutorial="source-selector-button"]',
    title: '选择上下文',
    body: '这个按钮用来附加文件、文件夹和资料源。需要智能体看什么，就从这里显式加入。',
  },
  {
    target: 'send-button',
    selector: '[data-tutorial="send-button"]',
    title: '开始执行',
    body: '确认任务和上下文后从这里发送。涉及文件改动时，变更会进入可查看、可接受或拒绝的流程。',
  },
]
