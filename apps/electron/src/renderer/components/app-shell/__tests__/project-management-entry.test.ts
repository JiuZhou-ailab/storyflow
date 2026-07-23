// input: AppShell, TopBar, ActivityRail, and ProjectManagerPanel source
// output: Static regression for popover-only project management IA
// pos: Full-page ProjectHub is abandoned; rail popover is the manage surface

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const topBarSource = readFileSync(new URL('../TopBar.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const activityRailPath = fileURLToPath(new URL('../ActivityRail.tsx', import.meta.url))
const activityRailSource = readFileSync(activityRailPath, 'utf8')
const projectSwitcherPath = fileURLToPath(new URL('../ProjectSwitcherPopover.tsx', import.meta.url))
const projectSwitcherSource = readFileSync(projectSwitcherPath, 'utf8')
const projectManagerPath = fileURLToPath(new URL('../ProjectManagerPanel.tsx', import.meta.url))
const projectManagerSource = readFileSync(projectManagerPath, 'utf8')

describe('project management entry', () => {
  it('keeps the project control on the original top rail slot', () => {
    expect(activityRailSource).toContain('data-tutorial="activity-project-hub"')
    expect(activityRailSource).toContain('aria-label="项目与工作区"')
    expect(activityRailSource).toContain('aria-label="项目"')
    expect(topBarSource).not.toContain('onOpenProjectHub')
  })

  it('hosts create/import/remote/rename/remove inside the project manager panel', () => {
    expect(existsSync(projectManagerPath)).toBe(true)
    expect(projectManagerSource).toContain('data-testid="project-manager-panel"')
    expect(projectManagerSource).toContain('新建项目')
    expect(projectManagerSource).toContain('导入文件夹')
    expect(projectManagerSource).toContain('连接远端')
    expect(projectManagerSource).toContain('最近项目')
    expect(projectManagerSource).toContain('返回项目')
    expect(projectManagerSource).toContain('<ProjectActionButton')
    expect(projectManagerSource).not.toContain('ProjectActionCard')
    expect(projectManagerSource).toContain('重命名')
    expect(projectManagerSource).toContain('移除')
    expect(projectManagerSource).toContain('新窗口打开')
    expect(projectManagerSource).toContain("view === 'create'")
    expect(projectManagerSource).toContain('<AddWorkspaceStep_CreateNew')
    expect(projectManagerSource).toContain('<AddWorkspaceStep_OpenFolder')
    expect(projectManagerSource).toContain('<AddWorkspaceStep_ConnectRemote')
    expect(projectManagerSource).toContain('embedded')
    expect(projectManagerSource).not.toContain('管理全部项目')
    expect(projectSwitcherSource).toContain('<ProjectManagerPanel')
    expect(projectSwitcherSource).toContain('variant="dialog"')
    expect(projectSwitcherSource).toContain('<Dialog')
    expect(projectSwitcherSource).toContain('onWorkspaceCreated={onWorkspaceCreated}')
    expect(appSource).toContain('variant="standalone"')
    expect(appSource).toContain('{...projectManagerActions}')
    expect(appSource).toContain('onWorkspaceCreated:')
    expect(appSource).not.toMatch(/<ProjectHub[\s>]/)
  })

  it('wires project manager actions through the room AppShell rail', () => {
    expect(appShellSource).toContain('onWorkspaceCreated={onWorkspaceCreatedFromRail ?? onWorkspaceCreated}')
    expect(appShellSource).toContain('onRenameProject={onRenameProject}')
    expect(appShellSource).toContain('onRemoveProject={onRemoveProject}')
    expect(appShellSource).toContain('onOpenProjectInNewWindow={onOpenProjectInNewWindow}')
    expect(appShellSource).toContain('workspaces={workspaces}')
    expect(appShellSource).toContain('void onSelectWorkspace?.(workspaceId)')
    expect(activityRailSource).toContain('<ProjectSwitcherPopover')
    expect(activityRailSource).toContain('onWorkspaceCreated={onWorkspaceCreated}')
    expect(activityRailSource).not.toContain('onCreateProject')
    expect(activityRailSource).not.toContain('onManageProjects')
    expect(activityRailSource).not.toContain('退出到作品库')
  })

  it('keeps a fixed foundation rail: project · writing · sources · skills · search', () => {
    expect(appShellSource).toContain('const showActivityRail = true')
    expect(appShellSource).toContain('<ActivityRail')
    expect(activityRailSource).toContain('label="写作工作区"')
    expect(activityRailSource).toContain('label="数据源"')
    expect(activityRailSource).toContain('label="技能"')
    expect(activityRailSource).toContain('label="搜索"')
    expect(activityRailSource).not.toContain('{!isLibrary ? (')
    expect(appShellSource).toContain('onOpenSources={handleSourcesClick}')
    expect(appShellSource).toContain('onOpenSkills={handleSkillsClick}')

    const projectNavStart = activityRailSource.indexOf('aria-label="项目与工作区"')
    const utilityNavStart = activityRailSource.indexOf('aria-label="账户与帮助"')
    expect(projectNavStart).toBeGreaterThan(-1)
    expect(utilityNavStart).toBeGreaterThan(-1)
    expect(activityRailSource.slice(projectNavStart, utilityNavStart)).toContain('activity-project-hub')
    expect(activityRailSource.slice(projectNavStart, utilityNavStart)).toContain('activity-writing')
    expect(activityRailSource.slice(projectNavStart, utilityNavStart)).toContain('activity-sources')
    expect(activityRailSource.slice(projectNavStart, utilityNavStart)).toContain('activity-skills')
    expect(activityRailSource.slice(projectNavStart, utilityNavStart)).toContain('activity-search')
  })

  it('uses the title bar only for window chrome and current project context', () => {
    expect(topBarSource).toContain('data-testid="window-title-bar"')
    expect(topBarSource).not.toContain('<WorkspaceSwitcher')
    expect(topBarSource).not.toContain('onOpenProjectHub')
  })

  it('remounts the project room shell when the active workspace changes', () => {
    expect(appSource).toContain('key={windowWorkspaceId ?? \'no-workspace\'}')
    expect(appSource).toContain('<WorkspaceSurface')
  })
})
