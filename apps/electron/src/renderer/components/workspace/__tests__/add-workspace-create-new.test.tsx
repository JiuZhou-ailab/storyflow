// input: New-workspace form props and workspace path inputs
// output: Regression coverage for blank workspace creation UI and path resolution
// pos: Protects the user-visible name-and-location-only creation contract

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
let buildWorkspaceFolderPath: typeof import('../AddWorkspaceStep_CreateNew').buildWorkspaceFolderPath

beforeAll(async () => {
  const module = await import('../AddWorkspaceStep_CreateNew')
  AddWorkspaceStep_CreateNew = module.AddWorkspaceStep_CreateNew
  buildWorkspaceFolderPath = module.buildWorkspaceFolderPath
})

describe('AddWorkspaceStep_CreateNew', () => {
  it('renders only the project name and location choices', () => {
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
    expect(html.match(/type="radio"/g) ?? []).toHaveLength(2)
    expect(html.match(/name="location"/g) ?? []).toHaveLength(2)
    expect(html).not.toContain('Method Pack')
    expect(html).not.toContain('短篇/中篇小说')
    expect(html).not.toContain('长文小说')
    expect(html).not.toContain('剧本逻辑')
    expect(html).not.toContain('自由创作')
  })

  it('preserves default and custom project paths for Chinese names on Windows', () => {
    expect(buildWorkspaceFolderPath({
      homeDir: 'C:\\Users\\zjding',
      name: '九州小说',
      customPath: null,
      locationOption: 'default',
    })).toMatch(/^C:\\Users\\zjding\\\.craft-agent\\workspaces\\workspace-[a-z0-9]+$/)

    expect(buildWorkspaceFolderPath({
      homeDir: 'C:\\Users\\zjding',
      name: '九州小说',
      customPath: 'D:\\写作项目',
      locationOption: 'custom',
    })).toMatch(/^D:\\写作项目\\workspace-[a-z0-9]+$/)
  })
})
