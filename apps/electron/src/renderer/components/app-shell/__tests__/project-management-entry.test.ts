// input: AppShell, TopBar, ActivityRail, and WorkspaceSwitcher source
// output: Static regression coverage for the global project-management entry point and shell navigation IA
// pos: Keeps ProjectHub discoverable after a project has already been opened

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const topBarSource = readFileSync(new URL('../TopBar.tsx', import.meta.url), 'utf8')
const panelHeaderSource = readFileSync(new URL('../PanelHeader.tsx', import.meta.url), 'utf8')
const switcherSource = readFileSync(new URL('../WorkspaceSwitcher.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const activityRailFramePath = fileURLToPath(new URL('../ActivityRailFrame.tsx', import.meta.url))
const activityRailFrameExists = existsSync(activityRailFramePath)
const activityRailFrameSource = activityRailFrameExists ? readFileSync(activityRailFramePath, 'utf8') : ''
const activityRailPath = fileURLToPath(new URL('../ActivityRail.tsx', import.meta.url))
const activityRailExists = existsSync(activityRailPath)
const activityRailSource = activityRailExists ? readFileSync(activityRailPath, 'utf8') : ''

describe('project management entry', () => {
  it('routes ProjectHub through the activity rail instead of the window title bar', () => {
    expect(appSource).toContain('handleOpenProjectHub')
    expect(appSource).toContain("setAppState('project-hub')")
    expect(appShellSource).toContain('onOpenProjectHub')
    expect(appShellSource).toContain('onOpenProjectHub={onOpenProjectHub}')
    expect(activityRailSource).toContain('label="项目中心"')
    expect(topBarSource).not.toContain('onOpenProjectHub')
  })

  it('uses the title bar only for window chrome and current project context', () => {
    expect(topBarSource).not.toContain('<WorkspaceSwitcher')
    expect(topBarSource).not.toContain('<ProjectBreadcrumb')
    expect(topBarSource).not.toContain('DropdownMenu')
    expect(topBarSource).not.toContain('TopBarButton')
    expect(topBarSource).not.toContain('onNewChat')
    expect(topBarSource).not.toContain('onOpenSettings')
    expect(topBarSource).not.toContain('onBack')
    expect(topBarSource).not.toContain('onForward')
    expect(topBarSource).toContain('data-testid="window-title-bar"')
    expect(topBarSource).toContain('aria-label="窗口上下文"')
    expect(topBarSource).toContain("from './layout-constants'")
    expect(topBarSource).toContain('getWorkspaceProjectTypeLabel')
    expect(topBarSource).not.toContain('getNavigationContextLabel')
    expect(topBarSource).not.toContain('写作工作区')
    expect(topBarSource).toContain('left-1/2 top-1/2')
    expect(topBarSource).toContain('-translate-x-1/2 -translate-y-1/2')
    expect(switcherSource).not.toContain('管理所有项目')
  })

  it('keeps panel title dropdowns visually centered and subdued like editor tabs', () => {
    expect(panelHeaderSource).toContain('grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)]')
    expect(panelHeaderSource).toContain('h-7 max-w-full items-center justify-center')
    expect(panelHeaderSource).toContain('text-[13px] font-medium')
    expect(panelHeaderSource).toContain('leading-none')
    expect(panelHeaderSource).not.toContain('flex-1 min-w-0 flex items-center select-none')
    expect(panelHeaderSource).not.toContain('text-sm font-semibold truncate font-sans leading-tight')
    expect(panelHeaderSource).not.toContain('translate-y-[1px]')
  })

  it('moves primary project navigation into a VS Code style icon rail', () => {
    expect(activityRailExists).toBe(true)
    expect(appShellSource).toContain('import { ActivityRail }')
    expect(appShellSource).toContain('<ActivityRail')
    expect(appShellSource).toContain('onOpenProjectHub={onOpenProjectHub}')
    expect(appShellSource).toContain('onOpenWritingWorkspace={handleWritingWorkspaceClick}')
    expect(appShellSource).not.toContain('onOpenConversations=')
    expect(appShellSource).not.toContain('onOpenSources={handleSourcesClick}')
    expect(appShellSource).not.toContain('onOpenSkills={handleSkillsClick}')
    expect(appShellSource).toContain("onOpenSettings={() => handleSettingsClick('app')}")
    expect(activityRailSource).toContain('data-testid="activity-rail"')
    expect(activityRailSource).toContain('aria-label="主导航"')
    expect(activityRailSource).toContain('项目中心')
    expect(activityRailSource).toContain('写作工作区')
    expect(activityRailSource).not.toContain('activity-conversations')
    expect(activityRailSource).not.toContain('label="数据源"')
    expect(activityRailSource).not.toContain('label="技能"')
    expect(activityRailSource).not.toContain('dataTutorial="activity-sources"')
    expect(activityRailSource).not.toContain('dataTutorial="activity-skills"')
    expect(activityRailSource).toContain('账户与积分')
    expect(activityRailSource).not.toContain('my-1 h-px w-6 bg-border/50')
    // Sources/skills remain reachable from the writing tree secondary menu.
    expect(appShellSource).toContain("id: 'open-sources'")
    expect(appShellSource).toContain("id: 'open-skills'")
    expect(appShellSource).toContain('handleSourcesClick')
    expect(appShellSource).toContain('handleSkillsClick')
  })

  it('keeps app settings in the lower utility rail instead of the project rail group', () => {
    const projectNavStart = activityRailSource.indexOf('aria-label="项目与工作区"')
    const utilityNavStart = activityRailSource.indexOf('aria-label="账户与帮助"')
    const settingsButton = activityRailSource.indexOf('label="设置"')

    expect(projectNavStart).toBeGreaterThan(-1)
    expect(utilityNavStart).toBeGreaterThan(-1)
    expect(settingsButton).toBeGreaterThan(utilityNavStart)
    expect(activityRailSource.slice(projectNavStart, utilityNavStart)).not.toContain('label="设置"')
    expect(activityRailSource).toContain('dataTutorial="activity-settings"')
  })

  it('does not leave a flex gap between the activity rail and the writing catalog', () => {
    expect(appShellSource).toContain('const activityRailOffset = showActivityRail ? ACTIVITY_RAIL_WIDTH : 0')
    expect(appShellSource).toContain('gap: showActivityRail ? 0 : PANEL_GAP')
  })

  it('does not reset the completed first-run tour for every later project creation', () => {
    expect(appSource).not.toContain('storage.set(storage.KEYS.firstRunTourCompleted, false)')
    expect(appSource).toContain('if (!storage.get(storage.KEYS.firstRunTourCompleted, false))')
    expect(appSource).toContain('storage.set(storage.KEYS.firstRunTourPending, true)')
  })

  it('keeps ProjectHub and account center inside the same activity rail shell', () => {
    expect(activityRailFrameExists).toBe(true)
    expect(activityRailFrameSource).toContain('<ActivityRail')
    expect(activityRailSource).toContain("'project-hub'")
    expect(activityRailSource).toContain("'account'")
    expect(activityRailSource).toContain("activeItem === 'project-hub'")
    expect(activityRailSource).toContain("activeItem === 'account'")
    expect(appSource).toContain('<ActivityRailFrame')
    expect(appSource).toContain('activeItem="project-hub"')
    expect(appSource).toContain('activeItem="account"')
    expect(appSource).not.toContain('onOpenSources=')
    expect(appSource).not.toContain('onOpenSkills=')
    expect(appSource).toContain('handleOpenActiveProjectSearch')
  })

  it('keeps the top bar focused on window chrome and project context only', () => {
    expect(appShellSource).not.toContain('onNewChat={() => handleNewChat()}')
    expect(appShellSource).not.toContain('onOpenSettings={onOpenSettings}')
    expect(appShellSource).not.toContain('onOpenProjectHub={onOpenProjectHub}\n          onBack=')
    expect(topBarSource).not.toContain('workspaceTools?:')
    expect(topBarSource).not.toContain('rightTools?:')
    expect(topBarSource).not.toContain('<BrowserTabStrip')
    expect(topBarSource).not.toContain('<FeedbackDialog')
    expect(appShellSource).not.toContain('workspaceTools=')
    expect(appShellSource).not.toContain('rightTools=')
  })
})
