// input: Current ActivityRail project-button accessibility contract and deterministic perf fixture names
// output: Browser expressions that wait for and open writing or session-bearing fixture projects
// pos: Testable navigation contract shared by every Electron performance scenario

export const PROJECT_BUTTON_SELECTOR = [
  'button[aria-label^="项目："]',
  'button[aria-label^="Project:"]',
].join(', ')

export const WRITING_DIRECTORY_SELECTOR = '[data-panel-role="directory"]'
export const WRITING_TREE_ITEM_SELECTOR = '[role="treeitem"]'

const WRITING_FIXTURE_NAME = '400章长篇小说'
const WRITING_CHAPTER_DIRECTORY_TITLE = '正文'

export type PerfFixtureProject = 'writing' | 'sessions'

export function projectButtonsReadyExpression(): string {
  return `document.querySelectorAll(${JSON.stringify(PROJECT_BUTTON_SELECTOR)}).length > 0`
}

export function openFixtureProjectExpression(project: PerfFixtureProject): string {
  return `(() => {
    const buttons = Array.from(document.querySelectorAll(${JSON.stringify(PROJECT_BUTTON_SELECTOR)}))
    for (const button of buttons) {
      const accessibleName = button.getAttribute('aria-label') || ''
      const name = (
        button.getAttribute('title')
        || accessibleName.replace(/^(?:项目：|Project:\\s*)/i, '')
      ).trim()
      const isWritingFixture = name === ${JSON.stringify(WRITING_FIXTURE_NAME)}
      if (${project === 'writing' ? 'isWritingFixture' : '!isWritingFixture'}) {
        button.click()
        return name
      }
    }
    return null
  })()`
}

export function writingChapterLabel(chapter: number): string {
  return `第${String(chapter).padStart(3, '0')}章`
}

export function writingChapterMountedExpression(chapter: number): string {
  return `Array.from(document.querySelectorAll(${JSON.stringify(
    `${WRITING_DIRECTORY_SELECTOR} ${WRITING_TREE_ITEM_SELECTOR}`,
  )})).some((element) => (element.textContent || '').includes(${JSON.stringify(writingChapterLabel(chapter))}))`
}

export function expandWritingChapterDirectoryExpression(): string {
  return `(() => {
    const panel = document.querySelector(${JSON.stringify(WRITING_DIRECTORY_SELECTOR)})
    const row = Array.from(panel?.querySelectorAll(${JSON.stringify(WRITING_TREE_ITEM_SELECTOR)}) || [])
      .find((element) => element.firstElementChild?.getAttribute('title') === ${JSON.stringify(WRITING_CHAPTER_DIRECTORY_TITLE)})
    if (!row) return null
    if (row.getAttribute('aria-expanded') === 'true') return 'already-expanded'
    const toggle = row.querySelector('button')
    if (!toggle) return null
    toggle.click()
    return 'expanded'
  })()`
}

export function openWritingChapterExpression(chapter: number): string {
  return `(() => {
    const panel = document.querySelector(${JSON.stringify(WRITING_DIRECTORY_SELECTOR)})
    if (!panel) return null
    const target = Array.from(panel.querySelectorAll(${JSON.stringify(WRITING_TREE_ITEM_SELECTOR)}))
      .find((element) => (element.textContent || '').includes(${JSON.stringify(writingChapterLabel(chapter))}))
    if (!target) return null
    const scroller = Array.from(panel.querySelectorAll('*')).find((element) => {
      const overflowY = getComputedStyle(element).overflowY
      return element.scrollHeight > element.clientHeight + 1
        && (overflowY === 'auto' || overflowY === 'scroll')
    })
    if (!scroller) return null
    target.scrollIntoView({ block: 'center' })
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    if (target.getAttribute('aria-selected') === 'true') return 'already-selected'
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    return 'clicked'
  })()`
}
