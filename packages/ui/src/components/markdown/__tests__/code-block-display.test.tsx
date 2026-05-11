import * as React from 'react'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeBlock } from '../CodeBlock'

describe('CodeBlock display chrome', () => {
  it('keeps unlabeled plain text blocks quiet in rendered Markdown', () => {
    const html = renderToStaticMarkup(
      <CodeBlock
        code={'/workspace/\n├─ bible/\n└─ story/'}
        mode="full"
      />,
    )

    expect(html).not.toContain('plain text')
    expect(html).not.toContain('PLAIN TEXT')
    expect(html).not.toContain('aria-label="Copy code"')
    expect(html).toContain('aria-label="Copy text"')
  })

  it('keeps language labels for real code blocks', () => {
    const html = renderToStaticMarkup(
      <CodeBlock
        code={'const title = "Chapter 1"'}
        language="typescript"
        mode="full"
      />,
    )

    expect(html).toContain('typescript')
    expect(html).toContain('aria-label="Copy code"')
  })
})
