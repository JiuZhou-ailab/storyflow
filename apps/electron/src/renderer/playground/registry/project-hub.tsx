// input: ProjectManagerPanel and stable workspace fixtures
// output: Playground registry entry for reviewing the in-dialog project management surface
// pos: Development-only visual preview aligned with the production project dialog

import { ProjectManagerPanel } from '@/components/app-shell/ProjectManagerPanel'
import { ModalProvider } from '@/context/ModalContext'
import type { Workspace } from '../../../shared/types'
import type { ReactNode } from 'react'
import type { ComponentEntry } from './types'

const sampleWorkspaces: Workspace[] = [
  {
    id: 'local-dawn',
    name: '黎明手稿',
    rootPath: '/Users/zjding/novels/dawn',
    slug: 'dawn',
    createdAt: 1772834400000,
    lastAccessedAt: 1773309600000,
    projectType: 'novel',
    methodPackId: 'novel.claude-book',
  },
  {
    id: 'remote-river',
    name: '远端河岸',
    rootPath: '/Users/zjding/.craft-agent/workspaces/river',
    slug: 'river',
    createdAt: 1772409600000,
    lastAccessedAt: 1772877600000,
    projectType: 'short-form',
    methodPackId: 'short-form.article',
    remoteServer: {
      url: 'wss://river.storyflow.dev',
      token: 'playground-only',
      remoteWorkspaceId: 'remote-river',
    },
  },
  {
    id: 'missing-archive',
    name: '旧稿归档',
    rootPath: '/Volumes/Archive/storyflow/old-manuscript',
    slug: 'old-manuscript',
    createdAt: 1771113600000,
    lastAccessedAt: 1771113600000,
    projectType: 'general',
    methodPackId: 'novel.creative-writing',
  },
]

const noop = () => console.log('[Playground] ProjectManagerPanel action triggered')

function ProjectManagerPreviewWrapper({ children }: { children: ReactNode }) {
  return <ModalProvider>{children}</ModalProvider>
}

export const projectHubComponents: ComponentEntry[] = [
  {
    id: 'project-manager',
    name: 'ProjectManagerPanel',
    category: 'Project Hub',
    description: 'Project list with inline create, import, and remote connection subviews',
    component: ProjectManagerPanel,
    wrapper: ProjectManagerPreviewWrapper,
    props: [],
    variants: [
      {
        name: 'Recent projects',
        props: {
          workspaces: sampleWorkspaces,
          activeWorkspaceId: 'local-dawn',
        },
      },
      {
        name: 'Empty library',
        props: {
          workspaces: [],
          activeWorkspaceId: null,
        },
      },
    ],
    mockData: () => ({
      workspaces: sampleWorkspaces,
      activeWorkspaceId: 'local-dawn',
      variant: 'dialog',
      onSelectProject: noop,
      onWorkspaceCreated: async () => undefined,
      onOpenProjectInNewWindow: noop,
      onRenameProject: noop,
      onRemoveProject: noop,
    }),
    layout: 'full',
    previewOverflow: 'hidden',
  },
]
