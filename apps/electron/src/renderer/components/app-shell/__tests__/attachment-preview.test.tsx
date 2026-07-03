import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'

describe('AttachmentPreview', () => {
  it('uses thumbnail data before full image base64 for image previews', () => {
    const source = readFileSync(new URL('../AttachmentPreview.tsx', import.meta.url), 'utf-8')
    const imageSrcStart = source.indexOf('const imageSrc =')
    const imageSrcEnd = source.indexOf('return (', imageSrcStart)
    const imageSrcBlock = source.slice(imageSrcStart, imageSrcEnd)

    expect(imageSrcBlock).toContain('const imageSrc = hasThumbnail')
    expect(imageSrcBlock.indexOf('hasThumbnail')).toBeLessThan(imageSrcBlock.indexOf('hasImageBase64'))
  })
})
