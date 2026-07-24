// input: Mixed native workspace catalog fixtures
// output: Regression coverage for stable file-tree projection and empty directories
// pos: Pure-model tests for the virtualized workspace file tree

import { describe, expect, it } from 'bun:test'
import {
  buildWorkspaceFileTree,
  advanceWorkspaceCatalogRevision,
  collectWorkspaceTreeDirectoryIds,
  getDefaultWritingExpandedIds,
  getWorkspaceTreeExpansionDelta,
  readWorkspaceCatalogRevision,
  reduceWorkspaceStateAfterDeletion,
  resolveWorkspaceCreateRelativePath,
  resolveWorkspaceImportRelativePath,
} from '../workspace-file-tree-model'

describe('workspace file tree model', () => {
  it('defaults expand state to the project root without privileging content folders', () => {
    expect(getDefaultWritingExpandedIds('novel-1')).toEqual([
      'writing:project:novel-1',
    ])
  })

  it('builds a directory-first natural-order tree with stable ids', () => {
    const root = buildWorkspaceFileTree({
      workspaceId: 'novel-1',
      workspaceName: '我的小说',
      rootPath: '/workspace/novel-1',
      directories: ['正文', '正文/空目录', '全局'],
      files: [
        { path: '/workspace/novel-1/正文/10.md', relativePath: '正文/10.md' },
        { path: '/workspace/novel-1/正文/2.md', relativePath: '正文/2.md' },
        { path: '/workspace/novel-1/README.md', relativePath: 'README.md' },
      ],
    })

    expect(root.id).toBe('writing:project:novel-1')
    expect(root.fileCount).toBe(3)
    expect(root.children?.map(node => node.type)).toEqual(['directory', 'directory', 'file'])
    expect(root.children?.at(-1)?.name).toBe('README.md')

    const manuscript = root.children?.find(node => node.name === '正文')
    expect(manuscript?.id).toBe('writing:folder:正文')
    expect(manuscript?.children?.map(node => node.name)).toEqual(['空目录', '2.md', '10.md'])
    expect(manuscript?.children?.[0]?.children).toEqual([])
    expect(manuscript?.fileCount).toBe(2)
    expect(collectWorkspaceTreeDirectoryIds(root)).toEqual([
      'writing:project:novel-1',
      'writing:folder:全局',
      'writing:folder:正文',
      'writing:folder:正文/空目录',
    ])
  })

  it('reduces a deleted folder into one coherent catalog, selection, and expansion state', () => {
    const files = [
      { path: '/workspace/novel-1/前言.md', relativePath: '前言.md' },
      { path: '/workspace/novel-1/正文/01.md', relativePath: '正文/01.md' },
      { path: '/workspace/novel-1/正文/02.md', relativePath: '正文/02.md' },
      { path: '/workspace/novel-1/附录.md', relativePath: '附录.md' },
    ]

    const result = reduceWorkspaceStateAfterDeletion({
      files,
      directories: ['正文', '正文/草稿', '资料'],
      expandedIds: new Set([
        'writing:project:novel-1',
        'writing:folder:正文',
        'writing:folder:正文/草稿',
        'writing:folder:资料',
      ]),
      selectedPath: '/workspace/novel-1/正文/01.md',
      entry: {
        path: '/workspace/novel-1/正文',
        relativePath: '正文',
        type: 'directory',
      },
    })

    expect(result.files).toEqual([files[0], files[3]])
    expect(result.directories).toEqual(['资料'])
    expect(result.selectedPath).toBe('/workspace/novel-1/附录.md')
    expect([...result.expandedIds]).toEqual([
      'writing:project:novel-1',
      'writing:folder:资料',
    ])
  })

  it('selects the previous adjacent file when deletion removes the final subtree', () => {
    const result = reduceWorkspaceStateAfterDeletion({
      files: [
        { path: '/workspace/novel-1/前言.md', relativePath: '前言.md' },
        { path: '/workspace/novel-1/正文/01.md', relativePath: '正文/01.md' },
      ],
      directories: ['正文'],
      expandedIds: new Set(['writing:project:novel-1', 'writing:folder:正文']),
      selectedPath: '/workspace/novel-1/正文/01.md',
      entry: {
        path: '/workspace/novel-1/正文',
        relativePath: '正文',
        type: 'directory',
      },
    })

    expect(result.selectedPath).toBe('/workspace/novel-1/前言.md')
  })

  it('invalidates only catalog requests captured before the current mutation', () => {
    const revisions = new Map<string, number>()
    const root = '/workspace/novel-1'
    const capturedRevision = readWorkspaceCatalogRevision(revisions, root)

    expect(capturedRevision).toBe(0)
    expect(advanceWorkspaceCatalogRevision(revisions, root)).toBe(1)
    expect(readWorkspaceCatalogRevision(revisions, root)).not.toBe(capturedRevision)
    expect(readWorkspaceCatalogRevision(revisions, '/workspace/novel-2')).toBe(0)
  })

  it('reconciles expansion from open nodes instead of scanning closed directories', () => {
    const result = getWorkspaceTreeExpansionDelta({
      directoryIds: new Set(['root', 'chapter-1', 'chapter-2', 'notes']),
      expandedIds: new Set(['root', 'chapter-2', 'deleted-folder']),
      appliedExpandedIds: new Set(['root', 'chapter-1', 'deleted-folder']),
    })

    expect([...result.desiredExpandedIds]).toEqual(['root', 'chapter-2'])
    expect(result.openIds).toEqual(['chapter-2'])
    expect(result.closeIds).toEqual(['chapter-1', 'deleted-folder'])
  })

  it('resolves generic file and folder creation inside the selected directory', () => {
    expect(resolveWorkspaceCreateRelativePath('', '新章节', 'file')).toBe('新章节.md')
    expect(resolveWorkspaceCreateRelativePath('正文/第一卷', '新章节.txt', 'file')).toBe('正文/第一卷/新章节.txt')
    expect(resolveWorkspaceCreateRelativePath('正文', '第二卷', 'directory')).toBe('正文/第二卷')
    expect(resolveWorkspaceCreateRelativePath('正文', '../越界', 'file')).toBeNull()
    expect(resolveWorkspaceCreateRelativePath('正文', '资料.docx', 'file')).toBeNull()
  })

  it('imports supported text files into the selected directory without semantic routing', () => {
    expect(resolveWorkspaceImportRelativePath('', '/Users/me/Desktop/第七章.md')).toBe('第七章.md')
    expect(resolveWorkspaceImportRelativePath('资料', 'C:\\Users\\me\\Desktop\\笔记.TXT')).toBe('资料/笔记.TXT')
    expect(resolveWorkspaceImportRelativePath('资料', '/Users/me/Desktop/附件.docx')).toBeNull()
  })
})
