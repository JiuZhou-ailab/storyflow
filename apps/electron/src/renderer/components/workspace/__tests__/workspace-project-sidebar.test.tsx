// input: Expanded directory state and the real project-sidebar component
// output: Regression coverage for the directory module without duplicate header controls
// pos: Keeps directory visibility control on the document surface

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import { TooltipProvider } from '@craft-agent/ui/tooltip'
import { initReactI18next } from 'react-i18next'
import type {
  WorkspaceFileTreeHandle,
  WorkspaceFileTreeProps,
} from '../WorkspaceFileTree'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
setupI18n([initReactI18next])

let WorkspaceProjectSidebar: typeof import('../WorkspaceProjectSidebar').WorkspaceProjectSidebar

beforeAll(async () => {
  const module = await import('../WorkspaceProjectSidebar')
  WorkspaceProjectSidebar = module.WorkspaceProjectSidebar
})

const treeProps: WorkspaceFileTreeProps = {
  workspaceId: 'workspace-1',
  workspaceName: '测试项目',
  rootPath: '/tmp/story',
  files: [],
  directories: [],
  expandedIds: new Set(),
  labels: {
    rename: '重命名',
    delete: '删除',
  },
  onExpandedChange: () => {},
  onSelectFile: () => {},
  onMoveEntry: () => {},
  onRenameEntry: () => {},
  onDeleteEntry: () => {},
}

describe('WorkspaceProjectSidebar', () => {
  it('does not duplicate the document-owned directory toggle', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <WorkspaceProjectSidebar
          sidebarRef={React.createRef<HTMLDivElement>()}
          treeRef={React.createRef<WorkspaceFileTreeHandle>()}
          focused={false}
          loadingLabel="正在加载项目目录..."
          emptyHint="项目为空"
          treeProps={treeProps}
          onFocus={() => {}}
        />
      </TooltipProvider>
    )

    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('lucide-folder-open')
    expect(html).not.toContain('h-[42px]')
    expect(html).toContain('flex min-h-full flex-col font-sans')
  })
})
