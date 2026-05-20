// input: Tool start payloads for file writes
// output: Regression coverage for captured previous file content
// pos: Unit tests for session tool-input enrichment before renderer review

import { describe, expect, it } from 'bun:test'
import { captureWriteOriginalContent } from '../write-original-content'

describe('captureWriteOriginalContent', () => {
  it('adds previous_content for Write tools that overwrite an existing file', async () => {
    const input = await captureWriteOriginalContent({
      toolName: 'Write',
      input: {
        file_path: 'chapter.md',
        content: '# New',
      },
      workspaceRootPath: '/workspace',
      validatePath: async (path) => path,
      readTextFile: async (path) => {
        expect(path).toBe('/workspace/chapter.md')
        return '# Old'
      },
    })

    expect(input).toEqual({
      file_path: 'chapter.md',
      content: '# New',
      previous_content: '# Old',
    })
  })

  it('does not overwrite existing previous content metadata', async () => {
    const input = await captureWriteOriginalContent({
      toolName: 'Write',
      input: {
        file_path: 'chapter.md',
        content: '# New',
        previous_content: '# Existing',
      },
      workspaceRootPath: '/workspace',
      validatePath: async (path) => path,
      readTextFile: async () => {
        throw new Error('readTextFile should not be called')
      },
    })

    expect(input.previous_content).toBe('# Existing')
  })
})
