// input: Active workspace identity, focused renderer route, and root action registry
// output: Reversible ProjectHub route snapshot plus project-hub back shortcut handlers
// pos: ProjectHub navigation boundary; reuses the existing route and action authorities

import { useCallback, useRef } from 'react'

import { useAction } from '@/actions'
import type { Route } from '@/lib/navigate'

interface ProjectHubReturnLocation {
  workspaceId: string
  route: Route
}

export function getProjectHubReturnDestination(route: Route | null): string | undefined {
  const prefix = route?.split('/')[0]
  switch (prefix) {
    case 'writing': return '写作工作区'
    case 'sources': return '数据源'
    case 'skills': return '技能'
    case 'automations': return '自动化'
    case 'settings': return '设置'
    case 'allSessions':
    case 'flagged':
    case 'archived':
    case 'state':
    case 'label':
    case 'view':
      return '对话'
    default:
      return undefined
  }
}

export function useProjectHubReturnLocation(
  activeWorkspaceId: string | null,
  focusedRoute: Route | null,
) {
  const returnLocationRef = useRef<ProjectHubReturnLocation | null>(null)

  const captureReturnLocation = useCallback(() => {
    returnLocationRef.current = activeWorkspaceId && focusedRoute
      ? { workspaceId: activeWorkspaceId, route: focusedRoute }
      : null
  }, [activeWorkspaceId, focusedRoute])

  const clearReturnLocation = useCallback(() => {
    returnLocationRef.current = null
  }, [])

  const consumeReturnRoute = useCallback((fallback: Route): Route => {
    const location = returnLocationRef.current
    returnLocationRef.current = null
    return location?.workspaceId === activeWorkspaceId ? location.route : fallback
  }, [activeWorkspaceId])

  const location = returnLocationRef.current
  const returnDestination = location?.workspaceId === activeWorkspaceId
    ? getProjectHubReturnDestination(location.route)
    : undefined

  return {
    captureReturnLocation,
    clearReturnLocation,
    consumeReturnRoute,
    returnDestination,
  }
}

export function ProjectHubNavigationActions({ onReturn }: { onReturn: () => void }) {
  useAction('nav.goBack', onReturn)
  useAction('nav.goBackAlt', onReturn)
  return null
}
