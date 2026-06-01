import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'
import type { NavigationState } from '../../shared/types'

export interface AutoSelectionOptions {
  skipAutoSelect?: boolean
}

export type AutoSelectionResolver = (
  state: NavigationState,
  options?: AutoSelectionOptions
) => NavigationState

export function shouldPreserveProjectLandingRoute(params: URLSearchParams): boolean {
  if (params.get('panels')) return false
  const route = params.get('route')
  return !route || route === 'allSessions'
}

/**
 * Normalize a panel route during URL reconciliation.
 *
 * Ensures filter-only routes (e.g. `allSessions`) can be upgraded to
 * canonical detail routes (e.g. `allSessions/session/{id}`) via the same
 * auto-selection policy used by normal navigation.
 */
export function normalizePanelRouteForReconcile(
  route: ViewRoute,
  resolveAutoSelection: AutoSelectionResolver,
  options?: AutoSelectionOptions,
): ViewRoute {
  const navState = parseRouteToNavigationState(route)
  if (!navState) return route

  // Preserve explicit detail routes exactly as encoded in URL.
  // Reconciliation should only auto-select for filter/list routes.
  if ('details' in navState && navState.details) {
    return route
  }

  const resolved = resolveAutoSelection(navState, options)
  return buildRouteFromNavigationState(resolved) as ViewRoute
}
