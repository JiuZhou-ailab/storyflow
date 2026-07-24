// input: Project files and explicit file or folder selections
// output: Regression coverage for folder-first project export planning
// pos: Protects export planning before renderer UI writes files

import { describe, expect, it } from 'bun:test'
import {
  buildProjectExportPlan,
  createProjectExportFolderName,
  getProjectExportDirectories,
} from '../project-export'

describe('project export helpers', () => {
  it('exports only explicitly selected files without inferring their role', () => {
    const plan = buildProjectExportPlan([
      { path: '/project/draft.md', relativePath: 'draft.md' },
      { path: '/project/notes/research.txt', relativePath: 'notes/research.txt' },
      { path: '/project/assets/raw.json', relativePath: 'assets/raw.json' },
    ], {
      selectedPaths: ['notes/research.txt', 'assets/raw.json'],
    })

    expect(plan.entries).toEqual([
      {
        kind: 'copy',
        sourcePath: '/project/assets/raw.json',
        targetRelativePath: 'assets/raw.json',
      },
      {
        kind: 'copy',
        sourcePath: '/project/notes/research.txt',
        targetRelativePath: 'notes/research.txt',
      },
    ])
    expect(plan.sourceFileCount).toBe(2)
  })

  it('expands an explicit folder selection to every descendant file', () => {
    const plan = buildProjectExportPlan([
      { path: '/project/notes/z.md', relativePath: 'notes/z.md' },
      { path: '/project/notes/nested/a.md', relativePath: 'notes/nested/a.md' },
      { path: '/project/draft.md', relativePath: 'draft.md' },
    ], {
      selectedPaths: ['notes'],
    })

    expect(plan.entries).toEqual([
      { kind: 'copy', sourcePath: '/project/notes/nested/a.md', targetRelativePath: 'notes/nested/a.md' },
      { kind: 'copy', sourcePath: '/project/notes/z.md', targetRelativePath: 'notes/z.md' },
    ])
    expect(plan.sourceFileCount).toBe(2)
  })

  it('ignores stale, duplicate, and traversal-like selections', () => {
    const plan = buildProjectExportPlan([
      { path: '/project/a.md', relativePath: 'a.md' },
      { path: '/project/b.md', relativePath: 'b.md' },
    ], {
      selectedPaths: ['a.md', 'a.md', 'missing.md', '../outside'],
    })

    expect(plan.entries).toEqual([
      { kind: 'copy', sourcePath: '/project/a.md', targetRelativePath: 'a.md' },
    ])
  })

  it('derives selectable folders from real files only', () => {
    expect(getProjectExportDirectories([
      { path: '/project/a.md', relativePath: 'a.md' },
      { path: '/project/notes/a.md', relativePath: 'notes/a.md' },
      { path: '/project/notes/nested/b.md', relativePath: 'notes/nested/b.md' },
    ])).toEqual(['notes', 'notes/nested'])
  })

  it('creates stable timestamped export folder names', () => {
    expect(createProjectExportFolderName(new Date('2026-05-12T09:08:07'))).toBe('exports/project-export-20260512-090807')
  })
})
