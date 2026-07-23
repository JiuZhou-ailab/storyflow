// input: Workspace creation preview panel props with Method Pack workflow summaries
// output: Regression coverage for the compact Method Pack preview surface
// pos: Ensures the new-workspace preview emphasizes staged setup over secondary contract lists

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import { initReactI18next } from 'react-i18next'
import { ModalProvider } from '../../../context/ModalContext'
import { getWorkspaceCreationMethodOption } from '../workspace-method-options'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
setupI18n([initReactI18next])

let MethodPackPreviewPanel: typeof import('../AddWorkspaceStep_CreateNew').MethodPackPreviewPanel
let AddWorkspaceStep_CreateNew: typeof import('../AddWorkspaceStep_CreateNew').AddWorkspaceStep_CreateNew

beforeAll(async () => {
  const module = await import('../AddWorkspaceStep_CreateNew')
  MethodPackPreviewPanel = module.MethodPackPreviewPanel
  AddWorkspaceStep_CreateNew = module.AddWorkspaceStep_CreateNew
})

describe('AddWorkspaceStep_CreateNew preview panel', () => {
  it('allocates a bounded desktop preview column beside the form', () => {
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

    expect(html).toContain('max-w-[88rem]')
    expect(html).toContain('lg:grid-cols-[minmax(17rem,0.9fr)_minmax(0,1.2fr)]')
    expect(html).toContain('lg:gap-0')
    expect(html).toContain('lg:pr-8')
    expect(html).not.toContain('shadow-strong')
    expect(html).not.toContain('rounded-[20px]')
    expect(html).toContain('短篇/中篇小说')
  })

  it('uses concise stages instead of an unbounded workflow diagram', () => {
    const option = getWorkspaceCreationMethodOption('novel.claude-book')
    const html = renderToStaticMarkup(
      <MethodPackPreviewPanel
        title={option.fallbackTitle}
        description={option.fallbackPreviewDescription}
        preview={option.richPreview}
        labels={{
          logic: 'Method logic',
          stages: 'Writing path',
          assets: 'Workspace assets',
          bestFor: 'Best for',
        }}
      />
    )

    expect(html).toContain('Writing path')
    expect(html).toContain('Workspace assets')
    expect(html).toContain('1.')
    expect(html).toContain(option.richPreview.stages[0]?.label ?? '')
    expect(html).not.toContain('Structure')
    expect(html).not.toContain('File contract')
    expect(html).not.toContain('craft-writing.json')
    expect(html).not.toContain('bible/style.md')
    expect(html).not.toContain('timeline/current-chapter.md')
  })
})
