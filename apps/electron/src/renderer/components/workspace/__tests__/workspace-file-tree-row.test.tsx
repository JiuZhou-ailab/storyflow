import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceFileTreeRow, WorkspaceFileTreeRowContext } from '../WorkspaceFileTreeRow'

it('highlights only the open file, independently of folder or stale tree selection', () => {
  function render(type: 'root' | 'file', path: string, selectedPath?: string) {
    return renderToStaticMarkup(
      <WorkspaceFileTreeRowContext.Provider value={{ selectedPath, labels: { rename: 'Rename', delete: 'Delete' } }}>
        <WorkspaceFileTreeRow node={{
          data: { type, path, name: 'Entry', relativePath: path, fileCount: 0 },
          isSelected: true, isLeaf: type === 'file',
        } as never} style={{}} tree={null as never} />
      </WorkspaceFileTreeRowContext.Provider>,
    )
  }
  expect(render('file', '/a.md', '/a.md')).toContain('data-active="true"')
  expect(render('file', '/a.md', '/b.md')).not.toContain('data-active')
  expect(render('file', '/a.md')).not.toContain('data-active')
  const folder = render('root', '', '/a.md')
  expect(folder).not.toContain('data-active')
  expect(folder).not.toContain('bg-foreground/[0.07]')
})
