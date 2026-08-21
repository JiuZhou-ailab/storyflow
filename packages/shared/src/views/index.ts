// input: Nothing — pure type re-exports
// output: The cross-host ViewConfig contract (config shape and evaluation context)
// pos: Shared half of the views subdomain; runtime engines live per host
//      (electron: apps/electron/src/shared/views, persistence: server-core services)

/**
 * View Types
 *
 * Views are dynamic, user-configurable filters computed from session state
 * using Filtrex expressions. They are never persisted on sessions — purely runtime.
 */

export type { ViewConfig, CompiledView, ViewEvaluationContext } from './types.ts';
