// input: Authored marketing example content
// output: Initial in-memory Project and two explicit writing scenarios
// pos: Demo-only fixtures; never loaded by a real Agent runtime
import type { Session, Workspace } from '../../../electron/src/shared/types'

export const workspace: Workspace = {
  id: 'demo-project', slug: 'demo-project', name: '黑洞直播 · 示例项目',
  rootPath: '/demo-project', createdAt: 1, rootAvailable: true,
}
export const chapterPath = `${workspace.rootPath}/第01章.md`
export const opening = '桌上的螺丝轻轻一颤，向球体滑了一寸。'
export const initialFiles = {
  [chapterPath]: `# 第一章 · 黑洞直播\n\n“兄弟们，今天给大家做一个很简单的物理小实验。”\n\n晚上八点十分，苏白准时开播。\n\n镜头里是一间不足十平米的出租屋。桌上摆着一颗黑色金属球。\n\n直播间人数：37。\n\n弹幕稀稀拉拉。\n\n【来了，苏老师今天又带大家养生啊。】\n\n苏白扫了眼弹幕，神色平静。他把金属球推到镜头前。\n\n“先说明，这不是玩具，也不是模型。”\n\n${opening}\n`,
  [`${workspace.rootPath}/人物.md`]: '# 人物\n\n## 苏白\n\n科学主播。平静、克制，让观众亲眼看到实验发生。\n',
  [`${workspace.rootPath}/创作要求.md`]: '# 创作要求\n\n让读者跟着主角一起发现异常。\n\n- 用动作制造悬念，不提前解释。\n- 对白自然，叙述克制。\n- 从只有 37 位观众的直播开始。\n',
}
export const scenarios = {
  continue: {
    kind: 'append', label: '续写一段', prompt: '参考人物与创作要求，给第01章续写一段。',
    before: '',
    after: `\n\n苏白伸手去按住它，指尖却停在半空。屏幕右下角，在线人数从37跳到了38。新来的观众没有发弹幕，只把头像换成了他的房间。`,
  },
  rewrite: {
    kind: 'replace', label: '改写悬念', prompt: '把第01章里螺丝滑动的段落改得更有悬念。',
    before: opening,
    after: '苏白还没碰到桌面，那颗螺丝便自己转了半圈。他移开金属球，螺丝停住了；再放回去，它又朝同一个方向滑了一寸。',
  },
} as const
export type ScenarioId = keyof typeof scenarios
const startedAt = Date.now()
export const initialSession: Session = {
  id: 'demo-writing', workspaceId: workspace.id, workspaceName: workspace.name,
  name: '第一章：让异常先发生', workingDirectory: workspace.rootPath,
  lastMessageAt: startedAt, createdAt: startedAt, isProcessing: false, permissionMode: 'allow-all',
  llmConnection: 'demo-local', model: 'demo', thinkingLevel: 'off',
  messages: [{
    id: 'welcome', role: 'assistant', timestamp: startedAt,
    content: '这是一个准备好的示例项目。你可以打开文件、亲自编辑正文，或从上方选择一个示例任务。\n\n- [第01章.md](第01章.md)：直播间里，桌上的螺丝突然滑向了金属球。\n- [人物.md](人物.md)：苏白的动机与表达方式\n- [创作要求.md](创作要求.md)：叙述语气和悬念安排\n\n任务使用预设示例结果，所有修改仅在本次体验中有效。',
  }],
}
