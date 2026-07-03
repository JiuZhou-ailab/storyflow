// input: Aggregated project summaries and renderer-owned project actions
// output: App-native ProjectHub surface for opening, creating, importing, and connecting projects
// pos: Pure renderer project selection component before workspace/session protocols are invoked

import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Cloud,
  Clock3,
  FileText,
  FolderOpen,
  HardDrive,
  Import,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
  Trash2,
  UserCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RenameDialog } from '@/components/ui/rename-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import type { ProjectKind, ProjectStatus, ProjectSummary } from '@/lib/project-summary'

export type ProjectHubProjectKind = ProjectKind
export type ProjectHubProjectStatus = ProjectStatus

export interface ProjectHubProject extends ProjectSummary {
  workspaceId?: string
}

export interface ProjectHubProps extends ProjectHubCallbacks {
  projects: ProjectHubProject[]
  activeWorkspaceId?: string | null
  onReturnToActiveProject?: () => void
}

export interface ProjectHubCallbacks {
  onOpenProject: (workspaceId: string) => void
  onCreateProject: () => void
  onImportProject: () => void
  onConnectRemoteProject: () => void
  onOpenAccount?: () => void
  onOpenProjectInNewWindow?: (workspaceId: string) => void
  onRenameProject?: (workspaceId: string, name: string) => void | Promise<void>
  onRemoveProject?: (workspaceId: string) => void | Promise<void>
}

export function ProjectHub({
  projects,
  activeWorkspaceId,
  onReturnToActiveProject,
  onOpenProject,
  onCreateProject,
  onImportProject,
  onConnectRemoteProject,
  onOpenAccount,
  onOpenProjectInNewWindow,
  onRenameProject,
  onRemoveProject,
}: ProjectHubProps) {
  const [query, setQuery] = useState('')
  const [renameProject, setRenameProject] = useState<ProjectHubProject | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const visibleProjects = useMemo(() => filterProjectHubProjects(projects, query), [projects, query])
  const activeProject = useMemo(
    () => projects.find((project) => activeWorkspaceId && getProjectWorkspaceId(project) === activeWorkspaceId),
    [projects, activeWorkspaceId]
  )

  const callbacks = {
    onOpenProject,
    onCreateProject,
    onImportProject,
    onConnectRemoteProject,
    onOpenProjectInNewWindow,
    onRenameProject: onRenameProject
      ? (workspaceId: string, name: string) => {
          const project = projects.find((item) => getProjectWorkspaceId(item) === workspaceId)
          if (!project) return
          setRenameProject(project)
          setRenameValue(name)
        }
      : undefined,
    onRemoveProject,
  }

  return (
    <section data-testid="project-hub-shell" className="min-h-full bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-[1240px] flex-col px-6 py-5 max-[720px]:px-4">
        <header
          data-testid="project-hub-toolbar"
          className="flex min-h-11 items-center justify-between gap-4 border-b border-border/60 pb-4 max-[720px]:items-start max-[720px]:flex-col"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground-2 text-foreground">
              <FolderOpen className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-[20px] font-semibold leading-7 text-foreground">项目管理</h1>
              </div>
            </div>
          </div>

          <div className="flex max-w-full flex-wrap items-center justify-end gap-2 max-[720px]:justify-start">
            {activeWorkspaceId && onReturnToActiveProject && (
              <Button
                type="button"
                variant="outline"
                className="h-9 max-w-[280px] rounded-lg px-3"
                onClick={onReturnToActiveProject}
              >
                <ArrowLeft className="size-4" />
                <span className="truncate">继续{activeProject ? `：${activeProject.name}` : '当前项目'}</span>
              </Button>
            )}
            {onOpenAccount && <ProjectHubAccountButton onOpenAccount={onOpenAccount} />}
          </div>
        </header>

        <div
          data-testid="project-hub-operations"
          className="flex items-center gap-3 py-4 max-[860px]:items-stretch max-[860px]:flex-col"
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">搜索项目</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目、路径或写作类型"
              className="h-10 rounded-lg bg-foreground-2 pl-9"
            />
          </label>
          <ProjectHubActions
            onCreateProject={onCreateProject}
            onImportProject={onImportProject}
            onConnectRemoteProject={onConnectRemoteProject}
          />
        </div>

        <main className="min-h-0 flex-1">
          {projects.length === 0 ? (
            <ProjectHubEmptyState onCreateProject={onCreateProject} />
          ) : visibleProjects.length === 0 ? (
            <ProjectHubNoResults query={query} onClear={() => setQuery('')} />
          ) : (
            <div
              data-testid="project-hub-gallery"
              aria-label="项目画廊"
              className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4"
            >
              {visibleProjects.map((project) => (
                <ProjectHubCard
                  key={project.id}
                  project={project}
                  isActive={activeWorkspaceId === getProjectWorkspaceId(project)}
                  actions={createProjectHubActions(project, callbacks)}
                />
              ))}
            </div>
          )}
        </main>
      </div>
      {renameProject && (
        <RenameDialog
          open
          onOpenChange={(open) => {
            if (!open) setRenameProject(null)
          }}
          title="重命名项目"
          value={renameValue}
          onValueChange={setRenameValue}
          onSubmit={() => {
            const project = renameProject
            const nextName = renameValue.trim()
            if (nextName && nextName !== project.name) {
              void onRenameProject?.(getProjectWorkspaceId(project), nextName)
            }
            setRenameProject(null)
          }}
          placeholder="输入项目名称"
        />
      )}
    </section>
  )
}

export function filterProjectHubProjects(projects: ProjectHubProject[], query: string): ProjectHubProject[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) {
    return projects
  }

  return projects.filter((project) => projectMatchesQuery(project, normalizedQuery))
}

export function projectMatchesQuery(project: ProjectHubProject, normalizedQuery: string): boolean {
  return (
    fieldIncludesQuery(project.name, normalizedQuery) ||
    fieldIncludesQuery(project.rootPath, normalizedQuery) ||
    fieldIncludesQuery(project.methodPackId, normalizedQuery) ||
    fieldIncludesQuery(getMethodPackLabel(project.methodPackId), normalizedQuery) ||
    fieldIncludesQuery(getProjectKindLabel(project.kind), normalizedQuery) ||
    fieldIncludesQuery(getProjectStatusLabel(project.status), normalizedQuery)
  )
}

function fieldIncludesQuery(value: string | undefined, normalizedQuery: string): boolean {
  return Boolean(value && value.toLocaleLowerCase().includes(normalizedQuery))
}

export function createProjectHubActions(project: ProjectHubProject, callbacks: ProjectHubCallbacks) {
  const workspaceId = getProjectWorkspaceId(project)

  return {
    openProject: () => callbacks.onOpenProject(workspaceId),
    openProjectInNewWindow: callbacks.onOpenProjectInNewWindow
      ? () => callbacks.onOpenProjectInNewWindow?.(workspaceId)
      : undefined,
    renameProject: callbacks.onRenameProject
      ? () => callbacks.onRenameProject?.(workspaceId, project.name)
      : undefined,
    removeProject: callbacks.onRemoveProject
      ? () => callbacks.onRemoveProject?.(workspaceId)
      : undefined,
  }
}

function ProjectHubAccountButton({ onOpenAccount }: { onOpenAccount: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-9 rounded-lg text-muted-foreground hover:text-foreground"
      aria-label="账户与积分"
      title="账户与积分"
      onClick={onOpenAccount}
    >
      <UserCircle className="size-4" />
    </Button>
  )
}

function ProjectHubActions({
  onCreateProject,
  onImportProject,
  onConnectRemoteProject,
}: Pick<ProjectHubCallbacks, 'onCreateProject' | 'onImportProject' | 'onConnectRemoteProject'>) {
  return (
    <div className="flex shrink-0 items-center gap-2 max-[860px]:grid max-[860px]:grid-cols-3 max-[520px]:grid-cols-1">
      <Button type="button" className="h-10 rounded-lg px-3" onClick={onCreateProject}>
        <Plus className="size-4" />
        新建项目
      </Button>
      <Button type="button" variant="outline" className="h-10 rounded-lg px-3" onClick={onImportProject}>
        <Import className="size-4" />
        导入本地
      </Button>
      <Button type="button" variant="outline" className="h-10 rounded-lg px-3" onClick={onConnectRemoteProject}>
        <Cloud className="size-4" />
        连接远端
      </Button>
    </div>
  )
}

function ProjectHubEmptyState({ onCreateProject }: Pick<ProjectHubCallbacks, 'onCreateProject'>) {
  return (
    <div
      data-testid="project-hub-empty-state"
      className="flex min-h-[420px] items-center justify-center rounded-lg border border-dashed border-border/80 bg-foreground-1.5 px-6 py-12 text-center"
    >
      <div className="max-w-[440px]">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-lg bg-background text-foreground shadow-minimal">
          <FolderOpen className="size-5" />
        </div>
        <h2 className="text-[18px] font-semibold leading-7 text-foreground">暂无项目</h2>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          创建或导入项目后，会在这里形成你的项目画廊。
        </p>
        <Button type="button" className="mt-5 h-9 rounded-lg px-3" onClick={onCreateProject}>
          <Plus className="size-4" />
          新建项目
        </Button>
      </div>
    </div>
  )
}

function ProjectHubNoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="rounded-lg border border-border/60 bg-foreground-1.5 px-6 py-10 text-center">
      <p className="text-[15px] font-medium text-foreground">没有匹配的项目</p>
      <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
        没有找到包含“{query.trim()}”的项目。
      </p>
      <Button type="button" variant="outline" className="mt-4 h-9 rounded-lg px-3" onClick={onClear}>
        清空搜索
      </Button>
    </div>
  )
}

function ProjectHubCard({
  project,
  isActive,
  actions,
}: {
  project: ProjectHubProject
  isActive: boolean
  actions: ReturnType<typeof createProjectHubActions>
}) {
  const status = getProjectStatus(project.status)
  const kind = getProjectKind(project.kind)
  const lastActivity = formatLastActivity(project.lastActivityAt)
  const methodPackLabel = getMethodPackLabel(project.methodPackId)
  const location = getProjectLocation(project)

  return (
    <article
      data-active={isActive || undefined}
      className={cn(
        'group flex min-h-[228px] flex-col rounded-lg border border-border/60 bg-foreground-1.5 transition-colors hover:border-foreground/20',
        isActive && 'border-accent/50 bg-background'
      )}
    >
      <button
        type="button"
        onClick={actions.openProject}
        className="flex min-h-0 flex-1 flex-col p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-background text-[17px] font-semibold text-foreground shadow-minimal">
            {getProjectInitial(project.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <h2 className="min-w-0 truncate text-[16px] font-semibold leading-6 text-foreground">{project.name}</h2>
              {isActive && (
                <span className="shrink-0 rounded-md bg-accent/10 px-2 py-1 text-[11px] font-medium leading-none text-accent">
                  当前
                </span>
              )}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
              <ProjectBadge className={status.className} icon={status.icon}>
                {status.label}
              </ProjectBadge>
              <ProjectBadge icon={kind.icon}>{kind.label}</ProjectBadge>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-[12px] leading-5 text-muted-foreground">
          <ProjectMeta icon={<Layers3 className="size-3.5" />}>{methodPackLabel}</ProjectMeta>
          <ProjectMeta icon={<FolderOpen className="size-3.5" />}>{location}</ProjectMeta>
          <ProjectMeta icon={<Clock3 className="size-3.5" />}>{lastActivity ?? '暂无活动'}</ProjectMeta>
        </div>
      </button>

      <div className="flex items-center justify-end gap-1.5 border-t border-border/50 px-3 py-2.5">
        <ProjectHubCardMenu project={project} actions={actions} />
        {actions.openProjectInNewWindow && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label={`在新窗口打开项目 ${project.name}`}
            title="在新窗口打开"
            onClick={actions.openProjectInNewWindow}
          >
            <ArrowUpRight className="size-4" />
          </Button>
        )}
        <Button type="button" className="h-9 rounded-lg px-3" onClick={actions.openProject}>
          <FolderOpen className="size-4" />
          打开
        </Button>
      </div>
    </article>
  )
}

function ProjectHubCardMenu({
  project,
  actions,
}: {
  project: ProjectHubProject
  actions: ReturnType<typeof createProjectHubActions>
}) {
  if (!actions.renameProject && !actions.removeProject) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-lg text-muted-foreground hover:text-foreground"
          aria-label={`管理项目 ${project.name}`}
          title="管理项目"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end">
        {actions.renameProject && (
          <StyledDropdownMenuItem onClick={actions.renameProject}>
            <Pencil className="size-3.5" />
            <span>重命名</span>
          </StyledDropdownMenuItem>
        )}
        {actions.renameProject && actions.removeProject && <StyledDropdownMenuSeparator />}
        {actions.removeProject && (
          <StyledDropdownMenuItem onClick={actions.removeProject} variant="destructive">
            <Trash2 className="size-3.5" />
            <span>移除项目</span>
          </StyledDropdownMenuItem>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectMeta({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  )
}

function ProjectBadge({
  children,
  className,
  icon,
}: {
  children: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md bg-background px-2 text-[11px] font-medium leading-none text-muted-foreground',
        className
      )}
    >
      {icon}
      {children}
    </span>
  )
}

function getProjectWorkspaceId(project: ProjectHubProject): string {
  return project.workspaceId ?? project.id
}

function getProjectStatus(status: ProjectHubProjectStatus): {
  label: string
  className: string
  icon: ReactNode
} {
  switch (status) {
    case 'local':
      return {
        label: getProjectStatusLabel(status),
        className: 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300',
        icon: <HardDrive className="size-3.5" />,
      }
    case 'remote':
      return {
        label: getProjectStatusLabel(status),
        className: 'text-blue-700 bg-blue-500/10 dark:text-blue-300',
        icon: <Cloud className="size-3.5" />,
      }
    case 'offline':
      return {
        label: getProjectStatusLabel(status),
        className: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
        icon: <TriangleAlert className="size-3.5" />,
      }
    case 'missing':
      return {
        label: getProjectStatusLabel(status),
        className: 'text-red-700 bg-red-500/10 dark:text-red-300',
        icon: <TriangleAlert className="size-3.5" />,
      }
  }
}

function getProjectKind(kind: ProjectHubProjectKind): {
  label: string
  icon: ReactNode
} {
  switch (kind) {
    case 'novel':
      return {
        label: getProjectKindLabel(kind),
        icon: <BookOpen className="size-3.5" />,
      }
    case 'short-form':
      return {
        label: getProjectKindLabel(kind),
        icon: <FileText className="size-3.5" />,
      }
    case 'screenplay':
      return {
        label: getProjectKindLabel(kind),
        icon: <Layers3 className="size-3.5" />,
      }
    case 'general':
      return {
        label: getProjectKindLabel(kind),
        icon: <Layers3 className="size-3.5" />,
      }
  }
}

function getProjectStatusLabel(status: ProjectHubProjectStatus): string {
  switch (status) {
    case 'local':
      return '本地'
    case 'remote':
      return '远端'
    case 'offline':
      return '离线'
    case 'missing':
      return '路径缺失'
  }
}

function getProjectKindLabel(kind: ProjectHubProjectKind): string {
  switch (kind) {
    case 'novel':
      return '小说'
    case 'screenplay':
      return '剧本'
    case 'short-form':
      return '短篇'
    case 'general':
      return '通用'
  }
}

function getMethodPackLabel(methodPackId: string | undefined): string {
  switch (methodPackId) {
    case 'novel.claude-book':
      return '长篇写作'
    case 'screenplay.logic':
      return '剧本逻辑'
    case 'novel.free-creation':
      return '自由创作'
    case 'short-form.article':
      return '短篇文章'
    default:
      return methodPackId ?? '未选择方法包'
  }
}

function getProjectLocation(project: ProjectHubProject): string {
  if (project.status === 'remote') {
    return '远端项目'
  }
  if (project.status === 'offline') {
    return '远端离线'
  }
  if (project.status === 'missing') {
    return '路径不可用'
  }
  if (!project.rootPath) {
    return '本地项目'
  }

  const normalizedPath = project.rootPath.replace(/\/$/, '')
  return normalizedPath.split('/').filter(Boolean).pop() ?? project.rootPath
}

function getProjectInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '项'
}

function formatLastActivity(lastActivityAt: number | string | undefined): string | null {
  if (!lastActivityAt) {
    return null
  }

  if (typeof lastActivityAt === 'number') {
    return new Date(lastActivityAt).toISOString().slice(0, 10)
  }

  const trimmed = lastActivityAt.trim()
  if (!trimmed) {
    return null
  }

  return trimmed.slice(0, 10)
}
