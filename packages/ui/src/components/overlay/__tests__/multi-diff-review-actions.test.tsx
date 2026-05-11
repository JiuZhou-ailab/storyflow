// input: File change review overlays with failed and successful changes
// output: Regression coverage for review action visibility
// pos: Ensures failed diff entries cannot be accepted or rejected from the UI

import * as React from 'react'
import { beforeAll, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MultiDiffPreviewOverlay, type FileChange } from '../MultiDiffPreviewOverlay'

beforeAll(async () => {
  if (i18n.isInitialized) return
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  })
})

function renderOverlay(change: FileChange): string {
  return renderToStaticMarkup(
    <MultiDiffPreviewOverlay
      isOpen
      embedded
      onClose={() => {}}
      changes={[change]}
      onAcceptChange={() => {}}
      onRejectChange={() => {}}
    />
  )
}

describe('MultiDiffPreviewOverlay review actions', () => {
  it('hides accept and reject actions for failed changes', () => {
    const html = renderOverlay({
      id: 'failed-change',
      filePath: '/repo/story/chapter.md',
      toolType: 'Edit',
      original: 'old',
      modified: 'new',
      error: 'old_string not found',
    })

    expect(html).toContain('Edit Failed')
    expect(html).not.toContain('Accept')
    expect(html).not.toContain('Reject')
  })
})
