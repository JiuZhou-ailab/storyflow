// input: Mixed native workspace catalog fixtures
// output: Regression coverage for stable file-tree projection and empty directories
// pos: Pure-model tests for the virtualized workspace file tree

import { describe, expect, it } from 'bun:test'
import { buildWorkspaceFileTree } from '../workspace-file-tree-model'

describe('workspace file tree model', () => {
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
  })
})
