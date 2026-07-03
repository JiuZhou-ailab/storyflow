// input: Aggregated project summaries and ProjectHub callbacks
// output: Static and helper coverage for the renderer-only project hub surface
// pos: Keeps project selection UI independent from Electron and workspace protocols

import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProjectHubProject } from '../ProjectHub'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let ProjectHub: typeof import('../ProjectHub').ProjectHub
let createProjectHubActions: typeof import('../ProjectHub').createProjectHubActions
let filterProjectHubProjects: typeof import('../ProjectHub').filterProjectHubProjects
let projectMatchesQuery: typeof import('../ProjectHub').projectMatchesQuery

beforeAll(async () => {
  const module = await import('../ProjectHub')
  ProjectHub = module.ProjectHub
  createProjectHubActions = module.createProjectHubActions
  filterProjectHubProjects = module.filterProjectHubProjects
  projectMatchesQuery = module.projectMatchesQuery
})

const projects: ProjectHubProject[] = [
  {
    id: 'local-dawn',
    name: '黎明手稿',
    rootPath: '/Users/zjding/novels/dawn',
    kind: 'novel',
    status: 'local',
    lastActivityAt: 1773309600000,
    methodPackId: 'novel.claude-book',
  },
  {
    id: 'remote-river',
    name: '远端河岸',
    rootPath: 'storyflow://remote/river',
    kind: 'screenplay',
    status: 'remote',
    methodPackId: 'screenplay.logic',
  },
]

const requiredProps = {
  onOpenProject: () => {},
  onCreateProject: () => {},
  onImportProject: () => {},
  onConnectRemoteProject: () => {},
}

describe('ProjectHub', () => {
  it('renders an app-native management surface with project creation actions', () => {
    const html = renderToStaticMarkup(
      <ProjectHub
        projects={[]}
        {...requiredProps}
      />
    )

    expect(html).toContain('data-testid="project-hub-shell"')
    expect(html).toContain('data-testid="project-hub-toolbar"')
    expect(html).toContain('data-testid="project-hub-operations"')
    expect(html).toContain('data-testid="project-hub-empty-state"')
    expect(html).toContain('项目管理')
    expect(html).toContain('暂无项目')
    expect(html).toContain('新建项目')
    expect(html).toContain('导入')
    expect(html).toContain('远端')
    expect(html).not.toContain('项目概览')
    expect(html).not.toContain('删除')
    expect(html).not.toContain('electronAPI')
  })

  it('renders a project gallery with user-facing status, method pack, and open actions', () => {
    const html = renderToStaticMarkup(
      <ProjectHub
        projects={projects}
        activeWorkspaceId="local-dawn"
        onReturnToActiveProject={() => {}}
        onRenameProject={() => {}}
        onRemoveProject={() => {}}
        {...requiredProps}
      />
    )

    expect(html).toContain('data-testid="project-hub-gallery"')
    expect(html).toContain('aria-label="项目画廊"')
    expect(html).toContain('黎明手稿')
    expect(html).toContain('dawn')
    expect(html).toContain('长篇写作')
    expect(html).toContain('本地')
    expect(html).toContain('小说')
    expect(html).toContain('远端河岸')
    expect(html).toContain('远端项目')
    expect(html).toContain('剧本逻辑')
    expect(html).toContain('远端')
    expect(html).toContain('剧本')
    expect(html).toContain('打开')
    expect(html).toContain('继续：黎明手稿')
    expect(html).toContain('管理项目 黎明手稿')
    expect(html).not.toContain('novel.claude-book')
    expect(html).not.toContain('删除项目')
  })

  it('keeps account access separated from project management', () => {
    const html = renderToStaticMarkup(
      <ProjectHub
        projects={projects}
        onOpenAccount={() => {}}
        {...requiredProps}
      />
    )

    expect(html).toContain('账户与积分')
    expect(html).not.toContain('个人资料页面')
  })

  it('filters projects by project name, path, and method pack id', () => {
    expect(filterProjectHubProjects(projects, '黎明').map((project) => project.id)).toEqual(['local-dawn'])
    expect(filterProjectHubProjects(projects, 'remote/river').map((project) => project.id)).toEqual(['remote-river'])
    expect(filterProjectHubProjects(projects, 'screenplay').map((project) => project.id)).toEqual(['remote-river'])
    expect(filterProjectHubProjects(projects, '剧本逻辑').map((project) => project.id)).toEqual(['remote-river'])
    expect(filterProjectHubProjects(projects, '远端').map((project) => project.id)).toEqual(['remote-river'])
    expect(filterProjectHubProjects(projects, '   ')).toBe(projects)
  })

  it('matches a project through fixed searchable fields without requiring caller-side labels', () => {
    expect(projectMatchesQuery(projects[0], '长篇写作')).toBe(true)
    expect(projectMatchesQuery(projects[0], '小说')).toBe(true)
    expect(projectMatchesQuery(projects[0], 'missing')).toBe(false)
  })

  it('routes project card actions through workspace id callbacks without touching Electron APIs', () => {
    const openedWorkspaceIds: string[] = []
    const renamedProjects: Array<[string, string]> = []
    const removedWorkspaceIds: string[] = []
    const actions = createProjectHubActions(projects[0], {
      ...requiredProps,
      onOpenProject: (workspaceId) => {
        openedWorkspaceIds.push(workspaceId)
      },
      onRenameProject: (workspaceId, name) => {
        renamedProjects.push([workspaceId, name])
      },
      onRemoveProject: (workspaceId) => {
        removedWorkspaceIds.push(workspaceId)
      },
    })

    actions.openProject()
    actions.renameProject?.()
    actions.removeProject?.()

    expect(openedWorkspaceIds).toEqual(['local-dawn'])
    expect(renamedProjects).toEqual([['local-dawn', '黎明手稿']])
    expect(removedWorkspaceIds).toEqual(['local-dawn'])
  })
})
