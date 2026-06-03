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
    target: 'writing-catalog',
    selector: '[data-tutorial="writing-catalog"]',
    title: '写作工作区',
    body: '这是当前项目的写作目录。先把长期资料和正文放在这里，智能体才能围绕项目状态工作，而不是只看一轮聊天。',
  },
  {
    target: 'writing-global-info',
    selector: '[data-tutorial="writing-global-info"]',
    title: '全局信息',
    body: '设定、人物、大纲、风格等长期有效的信息放在这里。越稳定的背景资料，越应该沉淀到全局信息里。',
  },
  {
    target: 'writing-manuscript',
    selector: '[data-tutorial="writing-manuscript"]',
    title: '正文区',
    body: '正文文件放在这里。让智能体续写、审稿或改正文时，主要围绕这些文件执行。',
  },
  {
    target: 'chat-input',
    selector: '[data-tutorial="chat-input"]',
    title: '给智能体下达任务',
    body: '在这里描述第一件要完成的事，例如续写一段、检查一章逻辑、整理人物设定。任务越具体，结果越可控。',
  },
  {
    target: 'source-selector-button',
    selector: '[data-tutorial="source-selector-button"]',
    title: '选择上下文',
    body: '需要智能体参考哪些文件、文件夹或资料源，就从这里显式加入。先给足上下文，再让它执行。',
  },
  {
    target: 'permission-mode-dropdown',
    selector: '[data-tutorial="permission-mode-dropdown"]',
    title: '执行权限',
    body: '这里控制智能体能做到什么程度。第一次使用建议选择需要确认的模式，先看清它会怎么改。',
  },
  {
    target: 'send-button',
    selector: '[data-tutorial="send-button"]',
    title: '开始执行',
    body: '确认任务、上下文和权限后从这里发送。涉及文件改动时，结果会进入可查看、可接受或拒绝的确认流程。',
  },
  {
    target: 'activity-feedback',
    selector: '[data-tutorial="activity-feedback"]',
    title: '帮助与反馈',
    body: '遇到问题或有建议，可以从这里提交反馈。项目资料、技能、设置等入口稍后再探索，不必在第一次任务前全部配置完。',
  },
]
