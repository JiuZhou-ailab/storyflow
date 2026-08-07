// input: MainContentPanel and App source text for session startup and deletion behavior
// output: Static regression checks for the always-available base conversation contract
// pos: Guards against exposing a no-conversation product state in the main chat surface

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const mainContentPanelSource = readFileSync(
  new URL('../MainContentPanel.tsx', import.meta.url),
  'utf-8'
)
const appSource = readFileSync(
  new URL('../../../App.tsx', import.meta.url),
  'utf-8'
)

describe('MainContentPanel base conversation', () => {
  it('renders a real base session instead of asking the user to select one', () => {
    expect(mainContentPanelSource).not.toContain('ProjectLandingEmptyState')
    expect(mainContentPanelSource).not.toContain('projectLanding.title')
    expect(mainContentPanelSource).not.toContain('session.selectConversation')
    expect(mainContentPanelSource).not.toContain('session.noSessionSelected')
    expect(mainContentPanelSource).toContain('<SessionBaseContent')
    expect(mainContentPanelSource).toContain('<SessionRouteContent')
  })

  it('creates the base session before session readiness and restores it after deletion', () => {
    expect(appSource).toContain('const hasRenderableSession = loadedSessions.some')
    expect(appSource).toContain('const baseSession = await createSessionOnServer(loadingWorkspaceId)')
    expect(appSource).toContain('const maintainBaseSessionAfterRemoval = useCallback')
    expect(appSource).toContain('const replacementId = await ensureBaseSessionId')
  })

  it('keeps ordinary chat rendering off the whole session metadata map subscription', () => {
    const mainComponentSource = mainContentPanelSource.slice(
      mainContentPanelSource.indexOf('export function MainContentPanel'),
      mainContentPanelSource.indexOf('function SessionBaseContent')
    )
    const writingSessionContentSource = mainContentPanelSource.slice(
      mainContentPanelSource.indexOf('function WritingSessionContent'),
      mainContentPanelSource.indexOf('function ChatPanelPlaceholder')
    )

    expect(mainContentPanelSource).toContain('sessionMetaAtomFamily(sessionId)')
    expect(mainComponentSource).not.toContain('useAtomValue(sessionMetaMapAtom)')
    expect(writingSessionContentSource).toContain('useAtomValue(sessionMetaMapAtom)')
  })
})
