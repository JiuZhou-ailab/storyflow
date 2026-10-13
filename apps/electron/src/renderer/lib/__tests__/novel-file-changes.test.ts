// input: Agent change paths in absolute, relative and diff-side forms
// output: Regression coverage for Project path projection of agent file changes
// pos: Guards the path match that lets agent edits refresh open Project documents

import { describe, expect, it } from 'bun:test'
import type { FileChange } from '@craft-agent/ui'
import { normalizeNovelFileChangePaths } from '../novel-file-changes'

function change(id: string, filePath: string): FileChange {
  return { id, filePath, toolType: 'Edit', original: 'old', modified: 'new' }
}

describe('novel file change paths', () => {
  it('normalizes relative agent change paths to workspace file paths', () => {
    const normalized = normalizeNovelFileChangePaths(
      [change('a', 'story/chapters/chapter-1.md'), change('b', './bible/characters/alice.md')],
      '/novel',
      [
        { path: '/novel/story/chapters/chapter-1.md', relativePath: 'story/chapters/chapter-1.md' },
        { path: '/novel/bible/characters/alice.md', relativePath: 'bible/characters/alice.md' },
      ]
    )

    expect(normalized.map(c => c.filePath)).toEqual([
      '/novel/story/chapters/chapter-1.md',
      '/novel/bible/characters/alice.md',
    ])
  })

  it('keeps changes scoped to the current project root', () => {
    const normalized = normalizeNovelFileChangePaths(
      [
        change('inside', '/workspace/project-id/story/chapters/chapter-1.md'),
        change('relative', 'bible/characters/alice.md'),
        change('outside', '/workspace/other-project/story/chapters/chapter-2.md'),
      ],
      '/workspace/project-id',
      [
        { path: '/workspace/project-id/story/chapters/chapter-1.md', relativePath: 'story/chapters/chapter-1.md' },
        { path: '/workspace/project-id/bible/characters/alice.md', relativePath: 'bible/characters/alice.md' },
      ]
    )

    expect(normalized.map(c => c.id)).toEqual(['inside', 'relative'])
  })
})
