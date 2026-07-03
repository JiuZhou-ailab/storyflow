import * as React from 'react'
import { Markdown, type RenderMode } from '@craft-agent/ui'

interface StreamingMarkdownProps {
  content: string
  isStreaming: boolean
  mode?: RenderMode
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
}

interface Block {
  content: string
  isCodeBlock: boolean
}

/**
 * Split content into blocks (paragraphs and code blocks)
 *
 * Block boundaries:
 * - Double newlines (paragraph separators)
 * - Code fences (```)
 *
 * This is intentionally simple - just string scanning, no regex per line.
 */
function splitIntoBlocks(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let currentBlock = ''
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check for code fence (``` at start of line, optionally followed by language)
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        // Starting a code block - flush current paragraph first
        if (currentBlock.trim()) {
          blocks.push({ content: currentBlock.trim(), isCodeBlock: false })
          currentBlock = ''
        }
        inCodeBlock = true
        currentBlock = line + '\n'
      } else {
        // Ending a code block
        currentBlock += line
        blocks.push({ content: currentBlock, isCodeBlock: true })
        currentBlock = ''
        inCodeBlock = false
      }
    } else if (inCodeBlock) {
      // Inside code block - append line
      currentBlock += line + '\n'
    } else if (line === '') {
      // Empty line outside code block = paragraph boundary
      if (currentBlock.trim()) {
        blocks.push({ content: currentBlock.trim(), isCodeBlock: false })
        currentBlock = ''
      }
    } else {
      // Regular text line
      if (currentBlock) {
        currentBlock += '\n' + line
      } else {
        currentBlock = line
      }
    }
  }

  // Flush remaining content
  if (currentBlock) {
    blocks.push({
      content: inCodeBlock ? currentBlock : currentBlock.trim(),
      isCodeBlock: inCodeBlock // Unclosed code block = still streaming
    })
  }

  return blocks
}

/**
 * Memoized block component
 *
 * Only re-renders if content or mode changes.
 */
const MemoizedBlock = React.memo(function Block({
  content,
  mode,
  onUrlClick,
  onFileClick,
}: {
  content: string
  mode: RenderMode
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
}) {
  return (
    <Markdown mode={mode} onUrlClick={onUrlClick} onFileClick={onFileClick}>
      {content}
    </Markdown>
  )
}, (prev, next) => {
  // Only re-render if content actually changed
  return prev.content === next.content && prev.mode === next.mode
})
MemoizedBlock.displayName = 'MemoizedBlock'

/**
 * StreamingMarkdown - Optimized markdown renderer for streaming content
 *
 * Splits content into blocks (paragraphs, code blocks) and memoizes each block
 * independently. Only the last (active) block re-renders during streaming.
 *
 * Key insight: Completed blocks keep position-based keys while MemoizedBlock
 * skips unchanged content; only the active tail block keeps changing.
 *
 * @example
 * Content: "Hello\n\n```js\ncode\n```\n\nMore..."
 *
 * Block 1: "Hello"           → key="block-0" → memoized ✓
 * Block 2: "```js\ncode\n```" → key="block-1" → memoized ✓
 * Block 3: "More..."         → key="active-2"     → re-renders
 */
export function StreamingMarkdown({
  content,
  isStreaming,
  mode = 'minimal',
  onUrlClick,
  onFileClick,
}: StreamingMarkdownProps) {
  // Split into blocks - memoized to avoid recomputation
  // Must be called unconditionally to satisfy Rules of Hooks
  const blocks = React.useMemo(
    () => (isStreaming ? splitIntoBlocks(content) : []),
    [content, isStreaming]
  )

  // Not streaming - use simple Markdown (no block splitting needed)
  if (!isStreaming) {
    return (
      <Markdown mode={mode} onUrlClick={onUrlClick} onFileClick={onFileClick}>
        {content}
      </Markdown>
    )
  }

  return (
    <>
      {blocks.map((block, i) => {
        const isLastBlock = i === blocks.length - 1

        // Complete blocks use position keys and MemoizedBlock compares content.
        // Last block uses "active" prefix → always re-renders on content change
        const key = isLastBlock
          ? `active-${i}`
          : `block-${i}`

        return (
          <MemoizedBlock
            key={key}
            content={block.content}
            mode={mode}
            onUrlClick={onUrlClick}
            onFileClick={onFileClick}
          />
        )
      })}
    </>
  )
}
