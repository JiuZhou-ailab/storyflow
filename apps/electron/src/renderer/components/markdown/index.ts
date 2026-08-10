// input: Shared Markdown UI and Electron streaming renderer
// output: Renderer-facing Markdown component exports
// pos: Electron Markdown component barrel

export {
  Markdown,
  MemoizedMarkdown,
  CollapsibleMarkdownProvider,
  CodeBlock,
  InlineCode,
  TiptapMarkdownEditor,
  type MarkdownProps,
  type RenderMode,
  type TiptapMarkdownEditorHandle,
  type TiptapMarkdownEditorProps,
} from '@craft-agent/ui'

// Local Electron-specific component
export { StreamingMarkdown } from './StreamingMarkdown'
