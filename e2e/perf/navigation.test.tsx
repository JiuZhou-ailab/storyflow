// input: Real ActivityRail server-rendered project buttons and perf navigation expressions
// output: Behavioral proof that both fixture project kinds are discoverable and clickable
// pos: Cross-boundary regression guard preventing product navigation drift from silently disabling perf E2E

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Provider, createStore } from 'jotai'
import { setupI18n } from '@craft-agent/shared/i18n'
import { initReactI18next } from 'react-i18next'
import {
  expandWritingChapterDirectoryExpression,
  openFixtureProjectExpression,
  openWritingChapterExpression,
  PROJECT_BUTTON_SELECTOR,
} from './navigation'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
setupI18n([initReactI18next])

let ActivityRail: typeof import('../../apps/electron/src/renderer/components/app-shell/ActivityRail').ActivityRail
let ResizableColumn: typeof import('../../apps/electron/src/renderer/components/app-shell/ResizableColumn').ResizableColumn

beforeAll(async () => {
  ActivityRail = (await import('../../apps/electron/src/renderer/components/app-shell/ActivityRail')).ActivityRail
  ResizableColumn = (await import('../../apps/electron/src/renderer/components/app-shell/ResizableColumn')).ResizableColumn
})

interface FakeButton {
  getAttribute(name: string): string | null
  click(): void
}

function projectButtonsFrom(html: string, clicked: string[]): FakeButton[] {
  return (html.match(/<button\b[^>]*>/g) ?? [])
    .map((tag) => {
      const attributes = Object.fromEntries(
        Array.from(tag.matchAll(/\s([\w-]+)="([^"]*)"/g), match => [match[1], match[2]])
      )
      return {
        attributes,
        getAttribute(name: string) {
          return this.attributes[name] ?? null
        },
        click() {
          clicked.push(this.attributes.title ?? this.attributes['aria-label'] ?? '')
        },
      }
    })
    .filter(button => /^(?:项目：|Project:)/i.test(button.getAttribute('aria-label') ?? ''))
}

function selectFromRenderedRail(html: string, project: 'writing' | 'sessions'): {
  clicked: string[]
  selected: string | null
} {
  const clicked: string[] = []
  const buttons = projectButtonsFrom(html, clicked)
  const fakeDocument = {
    querySelectorAll(selector: string) {
      expect(selector).toBe(PROJECT_BUTTON_SELECTOR)
      return buttons
    },
  }
  const select = new Function('document', `return ${openFixtureProjectExpression(project)}`)
  return {
    clicked,
    selected: select(fakeDocument) as string | null,
  }
}

function renderCurrentProjectRail(): string {
  return renderToStaticMarkup(
    <Provider store={createStore()}>
      <ActivityRail
        activeItem="writing"
        workspaces={[
          {
            id: 'perf-novel',
            name: '400章长篇小说',
            slug: 'perf-novel',
            rootPath: '/tmp/perf-novel',
            createdAt: 1,
          },
          {
            id: 'perf-sessions',
            name: '长篇小说 02',
            slug: 'perf-ws-02',
            rootPath: '/tmp/perf-ws-02',
            createdAt: 2,
          },
        ]}
        onSelectProject={() => {}}
      />
    </Provider>
  )
}

function executeChapterOpen(selected = false): {
  clicked: number
  scrolled: number
  result: string | null
} {
  let clicked = 0
  let scrolled = 0
  const target = {
    textContent: '第200章',
    getAttribute(name: string) {
      return name === 'aria-selected' && selected ? 'true' : null
    },
    scrollIntoView() {
      scrolled += 1
    },
    dispatchEvent(event: { type: string }) {
      if (event.type === 'click') clicked += 1
    },
  }
  const scroller = {
    scrollHeight: 12_000,
    clientHeight: 600,
    dispatchEvent() {},
  }
  const panel = {
    querySelectorAll(selector: string) {
      return selector === '[role="treeitem"]' ? [target] : [scroller]
    },
  }
  const fakeDocument = {
    querySelector(selector: string) {
      return selector === '[data-panel-role="directory"]' ? panel : null
    },
  }
  class FakeEvent {
    constructor(public type: string) {}
  }
  const open = new Function(
    'document',
    'getComputedStyle',
    'Event',
    'MouseEvent',
    'window',
    `return ${openWritingChapterExpression(200)}`,
  )
  const result = open(
    fakeDocument,
    () => ({ overflowY: 'auto' }),
    FakeEvent,
    FakeEvent,
    {},
  ) as string | null
  return { clicked, scrolled, result }
}

function executeChapterDirectoryExpand(expanded = false): {
  clicked: number
  result: string | null
} {
  let clicked = 0
  const row = {
    firstElementChild: {
      getAttribute(name: string) {
        return name === 'title' ? '正文' : null
      },
    },
    getAttribute(name: string) {
      return name === 'aria-expanded' && expanded ? 'true' : 'false'
    },
    querySelector() {
      return { click: () => { clicked += 1 } }
    },
  }
  const panel = {
    querySelectorAll(selector: string) {
      return selector === '[role="treeitem"]' ? [row] : []
    },
  }
  const fakeDocument = {
    querySelector(selector: string) {
      return selector === '[data-panel-role="directory"]' ? panel : null
    },
  }
  const expand = new Function('document', `return ${expandWritingChapterDirectoryExpression()}`)
  const result = expand(fakeDocument) as string | null
  return {
    clicked,
    result,
  }
}

describe('perf ActivityRail navigation contract', () => {
  it('opens the exact writing fixture through the current accessible project button', () => {
    const result = selectFromRenderedRail(renderCurrentProjectRail(), 'writing')

    expect(result.selected).toBe('400章长篇小说')
    expect(result.clicked).toEqual(['400章长篇小说'])
  })

  it('does not mistake an ordinary project containing 长篇 for the writing fixture', () => {
    const result = selectFromRenderedRail(renderCurrentProjectRail(), 'sessions')

    expect(result.selected).toBe('长篇小说 02')
    expect(result.clicked).toEqual(['长篇小说 02'])
  })
})

describe('perf writing catalog navigation contract', () => {
  it('uses the directory column scroll owner rendered by the current product', () => {
    const html = renderToStaticMarkup(
      <ResizableColumn
        mode="directory-dock"
        role="directory"
        sashLabel="目录"
        onResizeStart={() => {}}
        width={320}
        header={<div>目录</div>}
      >
        <div role="tree">章节</div>
      </ResizableColumn>
    )

    expect(html).toContain('data-panel-role="directory"')
    expect(html).toContain('min-h-0 flex-1 overflow-auto')
  })

  it('scrolls the outer directory owner and clicks the requested chapter', () => {
    expect(executeChapterOpen()).toEqual({
      clicked: 1,
      scrolled: 1,
      result: 'clicked',
    })
  })

  it('expands the deterministic chapter directory before looking for virtualized rows', () => {
    expect(executeChapterDirectoryExpand()).toEqual({
      clicked: 1,
      result: 'expanded',
    })
    expect(executeChapterDirectoryExpand(true)).toEqual({
      clicked: 0,
      result: 'already-expanded',
    })
  })

  it('does not create a false document switch for an already selected chapter', () => {
    expect(executeChapterOpen(true)).toEqual({
      clicked: 0,
      scrolled: 1,
      result: 'already-selected',
    })
  })
})
