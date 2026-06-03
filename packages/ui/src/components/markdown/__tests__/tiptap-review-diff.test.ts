// input: Previous and current TipTap documents parsed from Markdown
// output: Regression coverage for ProseMirror-native review diff ranges
// pos: Guards the editor diff layer against Markdown source-coordinate matching

import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { buildTiptapReviewDiffRanges } from '../TiptapReviewDiff'

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Markdown.configure({
        markedOptions: {
          gfm: true,
        },
      }),
    ],
    content,
    contentType: 'markdown',
  })
}

function parseMarkdown(editor: Editor, markdown: string) {
  return editor.schema.nodeFromJSON(editor.markdown.parse(markdown))
}

describe('buildTiptapReviewDiffRanges', () => {
  it('diffs parsed ProseMirror documents instead of matching Markdown source snippets', () => {
    const editor = createEditor('# 第一章\n\n她走进明亮的房间。\n\n尾声')

    try {
      const previousDoc = parseMarkdown(editor, '# 第一章\n\n她走进安静的房间。\n\n尾声')
      const ranges = buildTiptapReviewDiffRanges(previousDoc, editor.state.doc)

      expect(ranges).toHaveLength(1)
      expect(ranges[0]?.kind).toBe('replace')
      expect(ranges[0]?.deletedText).toContain('安静')
      expect(ranges[0]?.insertedText).toContain('明亮')
      expect(ranges[0]?.fromB).toBeLessThan(ranges[0]?.toB ?? 0)
    } finally {
      editor.destroy()
    }
  })
})
