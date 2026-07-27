// input: Representative file changes
// output: Regression checks for summary totals and actionable footer markup
// pos: Minimal behavior check for the assistant-turn diff summary

import * as React from 'react'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { FileChangesSummary, summarizeFileChanges } from '../FileChangesSummary'

const testI18n = createInstance().use(initReactI18next)
await testI18n.init({
  lng: 'zh-Hans',
  keySeparator: false,
  resources: {
    'zh-Hans': {
      translation: {
        'chat.fileChanges.editedFiles': '已编辑 {{count}} 个文件',
        'chat.fileChanges.review': '审核',
        'common.revert': '撤回',
      },
    },
  },
})

const changes = [
  {
    id: 'one',
    filePath: '/project/one.ts',
    toolType: 'Edit' as const,
    original: 'const value = 1\n',
    modified: 'const value = 2\nconst next = 3\n',
  },
  {
    id: 'two',
    filePath: '/project/two.ts',
    toolType: 'Write' as const,
    original: '',
    modified: 'export {}\n',
  },
]

describe('FileChangesSummary', () => {
  it('summarizes files and renders review and revert actions', () => {
    expect(summarizeFileChanges(changes)).toHaveLength(2)

    const html = renderToStaticMarkup(
      <I18nextProvider i18n={testI18n}>
        <FileChangesSummary changes={changes} onOpen={() => {}} onRevert={() => {}} />
      </I18nextProvider>
    )
    expect(html).toContain('已编辑 2 个文件')
    expect(html).toContain('撤回')
    expect(html).toContain('审核')
    expect(html).toContain('/project/one.ts')
  })
})
