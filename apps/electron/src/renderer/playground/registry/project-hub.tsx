// input: ProjectHub renderer component and stable mock project summaries
// output: Playground registry entry for reviewing the project management surface
// pos: Development-only visual preview for the authenticated project hub

import { ProjectHub, type ProjectHubProject } from '@/components/project-hub'
import type { ComponentEntry } from './types'

const sampleProjects: ProjectHubProject[] = [
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
    kind: 'short-form',
    status: 'remote',
    lastActivityAt: 1772877600000,
    methodPackId: 'short-form.article',
  },
  {
    id: 'missing-archive',
    name: '旧稿归档',
    rootPath: '/Volumes/Archive/storyflow/old-manuscript',
    kind: 'general',
    status: 'missing',
    methodPackId: 'novel.creative-writing',
  },
]

const noop = () => console.log('[Playground] ProjectHub action triggered')

export const projectHubComponents: ComponentEntry[] = [
  {
    id: 'project-hub',
    name: 'ProjectHub',
    category: 'Project Hub',
    description: 'Authenticated startup project management surface',
    component: ProjectHub,
    props: [],
    variants: [
      {
        name: 'Gallery',
        props: {
          projects: sampleProjects,
          activeWorkspaceId: 'local-dawn',
        },
      },
      {
        name: 'Empty',
        props: {
          projects: [],
          activeWorkspaceId: null,
        },
      },
    ],
    mockData: () => ({
      projects: sampleProjects,
      activeWorkspaceId: 'local-dawn',
      onOpenProject: noop,
      onCreateProject: noop,
      onImportProject: noop,
      onConnectRemoteProject: noop,
      onOpenAccount: noop,
      onReturnToActiveProject: noop,
      onOpenProjectInNewWindow: noop,
    }),
    layout: 'full',
    previewOverflow: 'hidden',
  },
]
