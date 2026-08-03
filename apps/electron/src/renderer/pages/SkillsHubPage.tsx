// input: Pi-native installed Skills, authenticated Skills Market catalog data, and the active workspace
// output: Native discovery with publisher provenance, installation, creation, opening, and publication actions
// pos: Default Skills route; local Pi catalog remains the authority for installed state

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Download,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { isDefaultGlobalAgentSkillSlug } from '@craft-agent/shared/agent-defaults'
import type { MarketSkillSummary } from '@craft-agent/shared/skills/marketplace'
import { skillsAtom } from '@/atoms/skills'
import { windowWorkspaceIdAtom, windowWorkspacesAtom } from '@/atoms/sessions'
import { AddSkillPopover } from '@/components/app-shell/AddSkillPopover'
import { PublishSkillDialog } from '@/components/app-shell/PublishSkillDialog'
import { SkillRemovalDialog } from '@/components/app-shell/SkillMenu'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { Input } from '@/components/ui/input'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { LoadedSkill } from '../../shared/types'

type CatalogView = 'company' | 'featured' | 'all'
const INSTALLED_SKILLS_PREVIEW_LIMIT = 10

export function filterMarketSkills(
  skills: MarketSkillSummary[],
  query: string,
  view: CatalogView,
): MarketSkillSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return skills.filter((skill) => {
    if (view === 'company' && skill.visibility !== 'company') return false
    if (!normalizedQuery && view === 'featured' && !skill.featured) return false
    if (!normalizedQuery) return true
    return [skill.displayName, skill.summary, skill.author, skill.publisher.displayName, skill.tags.join(' ')]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  })
}

export function isInstallableMarketSkill(skill: MarketSkillSummary): boolean {
  return /^[a-f0-9]{64}$/.test(skill.sha256)
}

export function getInstalledMarketSlug(skill: LoadedSkill): string | null {
  if (skill.origin !== 'top-level') return null
  const segments = skill.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return segments.at(-1) || null
}

export default function SkillsHubPage() {
  const { t } = useTranslation()
  const skills = useAtomValue(skillsAtom)
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const workspaces = useAtomValue(windowWorkspacesAtom)
  const workspace = workspaces.find(item => item.id === workspaceId) ?? null
  const currentWorkspaceId = React.useRef(workspaceId)
  currentWorkspaceId.current = workspaceId

  const [marketSkills, setMarketSkills] = React.useState<MarketSkillSummary[]>([])
  const [catalogLoading, setCatalogLoading] = React.useState(true)
  const [catalogError, setCatalogError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const [catalogView, setCatalogView] = React.useState<CatalogView>('featured')
  const [showAllInstalled, setShowAllInstalled] = React.useState(false)
  const [installingSlug, setInstallingSlug] = React.useState<string | null>(null)
  const [skillToPublish, setSkillToPublish] = React.useState<LoadedSkill | null>(null)
  const [skillToRemove, setSkillToRemove] = React.useState<LoadedSkill | null>(null)

  React.useEffect(() => {
    let active = true
    setCatalogLoading(true)
    setCatalogError(null)
    void window.electronAPI.listSkillsFromMarket()
      .then(response => {
        if (!active) return
        setMarketSkills(response.skills)
        setCatalogLoading(false)
      })
      .catch(error => {
        if (!active) return
        setCatalogError(error instanceof Error ? error.message : String(error))
        setCatalogLoading(false)
      })
    return () => { active = false }
  }, [reloadToken])

  const installedBySlug = React.useMemo(
    () => new Map(skills.flatMap(skill => {
      const marketSlug = getInstalledMarketSlug(skill)
      return marketSlug ? [[marketSlug, skill] as const] : []
    })),
    [skills],
  )
  const filteredInstalledSkills = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return skills
    return skills.filter(skill => [
      skill.metadata.displayName,
      skill.metadata.name,
      skill.metadata.description,
      skill.slug,
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalizedQuery))
  }, [query, skills])
  const visibleInstalledSkills = query || showAllInstalled
    ? filteredInstalledSkills
    : filteredInstalledSkills.slice(0, INSTALLED_SKILLS_PREVIEW_LIMIT)
  const filteredMarketSkills = React.useMemo(
    () => filterMarketSkills(marketSkills, query, catalogView),
    [catalogView, marketSkills, query],
  )
  const publishableSkills = React.useMemo(
    () => workspace?.remoteServer ? [] : skills.filter(skill => (
      skill.origin === 'top-level'
      && !isDefaultGlobalAgentSkillSlug(getInstalledMarketSlug(skill) ?? skill.slug)
    )),
    [skills, workspace?.remoteServer],
  )

  const openSkill = React.useCallback((skill: LoadedSkill) => {
    navigate(routes.view.skills(skill.slug))
  }, [])

  const installSkill = React.useCallback(async (skill: MarketSkillSummary) => {
    if (!workspaceId || installingSlug || !isInstallableMarketSkill(skill)) return
    const targetWorkspaceId = workspaceId
    setInstallingSlug(skill.slug)
    try {
      const downloaded = await window.electronAPI.downloadSkillFromMarket(skill)
      if (currentWorkspaceId.current !== targetWorkspaceId) {
        throw new Error(t('skillsMarket.runtimeChanged'))
      }
      const result = await window.electronAPI.importResources(
        targetWorkspaceId,
        downloaded.bundle,
        'skip',
        { skillScope: 'project' },
      )
      const bucket = result.skills
      if (bucket.imported.includes(skill.slug)) {
        toast.success(t('skillsMarket.imported', { slug: skill.slug }))
        return
      }
      if (bucket.skipped.includes(skill.slug)) {
        toast.info(t('skillsMarket.exists', { slug: skill.slug }))
        return
      }
      const reason = bucket.failed.find(item => item.id === skill.slug)?.error
      throw new Error(reason ?? t('skillsMarket.importFailed', { slug: skill.slug }))
    } catch (error) {
      toast.error(t('skillsMarket.importFailed', { slug: skill.slug }), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setInstallingSlug(null)
    }
  }, [installingSlug, t, workspaceId])

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('skillsHub.title', '技能')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('skillsHub.description', '为你的创作工作流安装和管理 Skills')}
            </p>
          </div>
          {workspace ? (
            <div className="flex shrink-0 items-center gap-2">
              <AddSkillPopover
                workspace={workspace}
                trigger={(
                  <Button type="button" size="sm" variant="outline">
                    <Plus aria-hidden="true" />
                    {t('skillsHub.create', '创建 Skill')}
                  </Button>
                )}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    disabled={publishableSkills.length === 0}
                    title={publishableSkills.length === 0
                      ? t('skillsHub.noPublishableSkills', '没有可发布的本地 Skill')
                      : undefined}
                  >
                    <Upload aria-hidden="true" />
                    {t('skillsHub.publish', '发布')}
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="end" className="min-w-56">
                  {publishableSkills.map(skill => (
                    <StyledDropdownMenuItem key={skill.slug} onClick={() => setSkillToPublish(skill)}>
                      <SkillAvatar skill={skill} size="sm" workspaceId={workspace.id} />
                      <span className="min-w-0 truncate">
                        {skill.metadata.displayName ?? skill.metadata.name}
                      </span>
                    </StyledDropdownMenuItem>
                  ))}
                </StyledDropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </header>

        <div className="relative mt-6">
          <label className="sr-only" htmlFor="skills-hub-search">
            {t('skillsHub.searchLabel', '搜索 Skills')}
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="skills-hub-search"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('skillsHub.searchPlaceholder', '搜索名称、发布者、内容来源或标签')}
            className="pl-9"
          />
        </div>

        <section className="mt-9" aria-labelledby="installed-skills-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="installed-skills-heading" className="text-sm font-semibold">
              {t('skillsHub.installed', '已安装')}
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {filteredInstalledSkills.length}
            </span>
          </div>
          {filteredInstalledSkills.length > 0 ? (
            <>
              <div id="installed-skills-grid" className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {visibleInstalledSkills.map(skill => (
                  <div
                    key={skill.slug}
                    className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={skill.metadata.description}
                  >
                    <button
                      type="button"
                      onClick={() => openSkill(skill)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId ?? undefined} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {skill.metadata.displayName ?? skill.metadata.name}
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t('skillManagement.manage', {
                            name: skill.metadata.displayName ?? skill.metadata.name,
                          })}
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <MoreHorizontal className="size-3.5" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <StyledDropdownMenuContent align="end" className="min-w-48">
                        {skill.origin === 'top-level'
                          && !isDefaultGlobalAgentSkillSlug(getInstalledMarketSlug(skill) ?? skill.slug)
                          && workspaceId ? (
                          <StyledDropdownMenuItem variant="destructive" onClick={() => setSkillToRemove(skill)}>
                            <Trash2 className="size-3.5" aria-hidden="true" />
                            {t('skillManagement.removeAction')}
                          </StyledDropdownMenuItem>
                        ) : (
                          <StyledDropdownMenuItem disabled>
                            {t('skillManagement.managedBySource', {
                              source: isDefaultGlobalAgentSkillSlug(getInstalledMarketSlug(skill) ?? skill.slug)
                                ? 'Storyflow'
                                : skill.source,
                            })}
                          </StyledDropdownMenuItem>
                        )}
                      </StyledDropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
              {!query && filteredInstalledSkills.length > INSTALLED_SKILLS_PREVIEW_LIMIT ? (
                <button
                  type="button"
                  aria-controls="installed-skills-grid"
                  aria-expanded={showAllInstalled}
                  onClick={() => setShowAllInstalled(value => !value)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showAllInstalled
                    ? t('skillsHub.collapseInstalled', '收起')
                    : t('skillsHub.showAllInstalled', '显示全部 {{count}} 个', { count: filteredInstalledSkills.length })}
                  <ChevronDown
                    className={cn('size-3.5 transition-transform', showAllInstalled && 'rotate-180')}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-border/80 px-4 py-5 text-sm text-muted-foreground">
              {query
                ? t('skillsHub.noInstalledMatches', '没有匹配的已安装 Skill')
                : t('skillsHub.noInstalled', '当前项目还没有安装 Skill')}
            </p>
          )}
        </section>

        <section className="mt-9" aria-labelledby="discover-skills-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
            <h2 id="discover-skills-heading" className="text-sm font-semibold">
              {t('skillsHub.discover', '发现')}
            </h2>
            <div className="flex rounded-md bg-foreground/[0.04] p-0.5" role="tablist" aria-label={t('skillsHub.catalogView', '目录范围')}>
              {([
                ...(marketSkills.some(skill => skill.visibility === 'company') ? ['company'] as const : []),
                'featured',
                'all',
              ] as const).map(view => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={catalogView === view}
                  onClick={() => setCatalogView(view)}
                  className={cn(
                    'rounded-[5px] px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    catalogView === view
                      ? 'bg-background text-foreground shadow-minimal'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {view === 'company'
                    ? t('skillsHub.company', '公司')
                    : view === 'featured'
                      ? t('skillsHub.featured', '精选')
                      : t('skillsHub.all', '全部')}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4" aria-live="polite">
            {catalogLoading ? (
              <>
                <p className="sr-only">{t('skillsHub.loading', '正在加载 Skills 目录')}</p>
                <CatalogSkeleton />
              </>
            ) : catalogError ? (
              <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/[0.04] px-4 py-4">
                <p className="text-sm font-medium">{t('skillsHub.loadFailed', 'Skills 目录加载失败')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{catalogError}</p>
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setReloadToken(value => value + 1)}>
                  {t('common.retry', '重试')}
                </Button>
              </div>
            ) : filteredMarketSkills.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/80 px-4 py-8 text-center">
                <Zap className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium">{t('skillsHub.noResults', '没有找到匹配的 Skill')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {catalogView === 'featured' && !query
                    ? t('skillsHub.noFeatured', '暂时没有精选 Skill，可以查看全部')
                    : t('skillsHub.adjustFilters', '尝试修改搜索词或切换目录范围')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
                {filteredMarketSkills.map(skill => {
                  const installed = installedBySlug.get(skill.slug)
                  const installing = installingSlug === skill.slug
                  const installable = isInstallableMarketSkill(skill)
                  return (
                    <article key={`${skill.slug}@${skill.version}`} className="flex min-w-0 items-start gap-3 border-b border-border/60 py-4">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-foreground/[0.03]">
                        <Zap className="size-4 text-muted-foreground" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <h3 className="truncate text-sm font-medium">{skill.displayName}</h3>
                          <span className="shrink-0 text-[11px] text-muted-foreground">v{skill.version}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {skill.summary}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => setQuery(skill.publisher.displayName)}
                            className="rounded-sm font-medium text-foreground/75 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={t('skillsHub.filterPublisher', {
                              defaultValue: '筛选发布者 {{name}}',
                              name: skill.publisher.displayName,
                            })}
                          >
                            {t('skillsHub.publishedBy', {
                              defaultValue: '{{name}} 发布',
                              name: skill.publisher.displayName,
                            })}
                          </button>
                          {' · '}
                          {skill.visibility === 'company'
                            ? t('skillsHub.companyVisibility', '公司内部')
                            : t('skillsHub.publicVisibility', '公开')}
                          {' · '}
                          {t('skillsHub.contentSource', {
                            defaultValue: '来源：{{source}}',
                            source: skill.author,
                          })}
                        </p>
                      </div>
                      {installed ? (
                        <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => openSkill(installed)}>
                          <Check aria-hidden="true" />
                          {t('skillsHub.open', '打开')}
                        </Button>
                      ) : installable ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          disabled={!workspaceId || installingSlug !== null}
                          onClick={() => void installSkill(skill)}
                        >
                          <Download aria-hidden="true" />
                          {installing
                            ? t('skillsHub.installing', '安装中')
                            : t('skillsHub.install', '安装')}
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="ghost" className="shrink-0" disabled>
                          {t('skillsHub.referenceOnly', '仅供参考')}
                        </Button>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {workspace ? (
        <PublishSkillDialog
          skill={skillToPublish}
          workspaceId={workspace.id}
          workspaceRootPath={workspace.rootPath}
          open={skillToPublish !== null}
          onOpenChange={open => { if (!open) setSkillToPublish(null) }}
          onPublished={() => setReloadToken(value => value + 1)}
        />
      ) : null}
      <SkillRemovalDialog
        skill={skillToRemove}
        workspaceId={workspaceId}
        open={skillToRemove !== null}
        onOpenChange={open => { if (!open) setSkillToRemove(null) }}
      />
    </main>
  )
}

function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-start gap-3 border-b border-border/60 py-4">
          <div className="size-10 shrink-0 animate-pulse rounded-lg bg-foreground/[0.06] motion-reduce:animate-none" />
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <div className="h-3 w-2/5 animate-pulse rounded bg-foreground/[0.07] motion-reduce:animate-none" />
            <div className="h-2.5 w-full animate-pulse rounded bg-foreground/[0.05] motion-reduce:animate-none" />
            <div className="h-2.5 w-3/5 animate-pulse rounded bg-foreground/[0.05] motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  )
}
