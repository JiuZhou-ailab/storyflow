// input: Local-project form props, selected folder paths, and optional project names
// output: Regression coverage for the folder-first UI and folder-name fallback
// pos: Protects the canonical local project creation contract

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import { initReactI18next } from 'react-i18next'
import { ModalProvider } from '../../../context/ModalContext'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
setupI18n([initReactI18next])

let AddWorkspaceStep_CreateNew: typeof import('../AddWorkspaceStep_CreateNew').AddWorkspaceStep_CreateNew
let resolveWorkspaceName: typeof import('../AddWorkspaceStep_CreateNew').resolveWorkspaceName

beforeAll(async () => {
  const module = await import('../AddWorkspaceStep_CreateNew')
  AddWorkspaceStep_CreateNew = module.AddWorkspaceStep_CreateNew
  resolveWorkspaceName = module.resolveWorkspaceName
})

describe('AddWorkspaceStep_CreateNew', () => {
  it('renders one local folder picker and one optional project name', () => {
    const html = renderToStaticMarkup(
      <ModalProvider>
        <AddWorkspaceStep_CreateNew
          onBack={() => {}}
          onCreate={async () => {}}
          isCreating={false}
          embedded
        />
      </ModalProvider>
    )

    expect(html.match(/data-slot="input"/g) ?? []).toHaveLength(1)
    expect(html).toContain('No folder selected')
    expect(html).toContain('Optional')
    expect(html).not.toContain('type="radio"')
    expect(html).not.toContain('Method Pack')
    expect(html).not.toContain('短篇/中篇小说')
    expect(html).not.toContain('长文小说')
    expect(html).not.toContain('剧本逻辑')
    expect(html).not.toContain('自由创作')
  })

  it('uses the folder name only when the optional project name is blank', () => {
    expect(resolveWorkspaceName('/Users/zjding/novels/九州小说', '')).toBe('九州小说')
    expect(resolveWorkspaceName('D:\\写作项目\\九州小说', '  自定义名称  ')).toBe('自定义名称')
  })
})
