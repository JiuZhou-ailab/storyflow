// input: Novel workspace files and export options
// output: Regression coverage for selectable writing workspace exports
// pos: Protects export planning before renderer UI writes files

import { describe, expect, it } from 'bun:test'
import {
  buildMergedManuscriptContent,
  buildNovelExportPlan,
  createNovelExportFolderName,
} from '../novel-export'

describe('novel export helpers', () => {
  it('exports only the selected writing sections', () => {
    const plan = buildNovelExportPlan([
      { path: '/novel/story/chapters/chapter-01.md', relativePath: 'story/chapters/chapter-01.md' },
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
      { path: '/novel/bible/characters/alice.md', relativePath: 'bible/characters/alice.md' },
    ], {
      sections: ['outline', 'characters'],
      mergeManuscript: false,
    })

    expect(plan.entries).toEqual([
      {
        kind: 'copy',
        sourcePath: '/novel/story/plan.md',
        targetRelativePath: 'story/plan.md',
      },
      {
        kind: 'copy',
        sourcePath: '/novel/bible/characters/alice.md',
        targetRelativePath: 'bible/characters/alice.md',
      },
    ])
    expect(plan.sourceFileCount).toBe(2)
  })

  it('can export manuscript chapters as one ordered file', () => {
    const plan = buildNovelExportPlan([
      { path: '/novel/story/chapters/chapter-10.md', relativePath: 'story/chapters/chapter-10.md' },
      { path: '/novel/story/chapters/chapter-2.md', relativePath: 'story/chapters/chapter-2.md' },
      { path: '/novel/story/chapters/chapter-1.md', relativePath: 'story/chapters/chapter-1.md' },
      { path: '/novel/story/plan.md', relativePath: 'story/plan.md' },
    ], {
      sections: ['manuscript', 'outline'],
      mergeManuscript: true,
    })

    expect(plan.entries).toEqual([
      {
        kind: 'merged-manuscript',
        sourcePaths: [
          '/novel/story/chapters/chapter-1.md',
          '/novel/story/chapters/chapter-2.md',
          '/novel/story/chapters/chapter-10.md',
        ],
        targetRelativePath: 'manuscript.md',
      },
      {
        kind: 'copy',
        sourcePath: '/novel/story/plan.md',
        targetRelativePath: 'story/plan.md',
      },
    ])
    expect(plan.sourceFileCount).toBe(4)
  })

  it('joins manuscript parts without adding headings or changing body text', () => {
    expect(buildMergedManuscriptContent([
      { sourcePath: '/novel/chapter-01.md', content: '# Chapter 1\n\nAlpha\n' },
      { sourcePath: '/novel/chapter-02.md', content: '  Beta' },
    ])).toBe('# Chapter 1\n\nAlpha\n\n  Beta\n')
  })

  it('creates stable timestamped export folder names', () => {
    expect(createNovelExportFolderName(new Date('2026-05-12T09:08:07'))).toBe('exports/novel-export-20260512-090807')
  })
})
