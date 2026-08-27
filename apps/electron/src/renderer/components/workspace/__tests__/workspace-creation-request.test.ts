// input: Renderer App and ActivityRail source
// output: Contract checks for native folder selection and zero-Session Project activation
// pos: Guards the single local Project registration entry and its lifecycle boundary

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const activityRailSource = readFileSync(new URL('../../app-shell/ActivityRail.tsx', import.meta.url), 'utf8')

describe('local Project registration request', () => {
  it('selects one native folder and opens the Project without creating a Session', () => {
    const start = appSource.indexOf('const handleAddLocalProject')
    const end = appSource.indexOf('const handleClientSignedIn', start)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const handler = appSource.slice(start, end)
    expect(handler).toContain('await window.electronAPI.openFolderDialog()')
    expect(handler).toContain('if (!rootPath) return')
    expect(handler).toContain('getPathBasename(rootPath)')
    expect(handler).toContain('await window.electronAPI.createWorkspace(rootPath, name)')
    expect(handler).toContain('await activateRuntimeWorkspace(workspace.id, routes.view.writing())')
    expect(handler).not.toContain('routes.action.newSession()')
    expect(handler).not.toContain('handleCreateSession')
    expect(handler).not.toContain('handleSelectProjectSession')
  })

  it('keeps the rail trigger as a direct application action', () => {
    expect(activityRailSource).not.toContain('ProjectSwitcherPopover')
    expect(activityRailSource).toContain(
      "aria-label={isAddingLocalProject ? '正在添加本地项目' : '添加本地项目'}"
    )
    expect(activityRailSource).toContain('onClick={() => { void onAddLocalProject?.() }}')
  })
})
