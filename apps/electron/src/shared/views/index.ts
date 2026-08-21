// input: ViewConfig contracts from @craft-agent/shared/views and local expression engine modules
// output: Electron-side views runtime — compilation, evaluation, and validation
// pos: Electron process-side half of the views subdomain; types remain in @craft-agent/shared/views

/**
 * Views Runtime (Electron)
 *
 * Dynamic views computed from session state using Filtrex expressions.
 * Never persisted on sessions — purely runtime evaluation.
 */

export type { ViewConfig, CompiledView, ViewEvaluationContext } from '@craft-agent/shared/views';
export { compileView, compileAllViews, evaluateViews, buildViewContext } from './evaluator.ts';
export { validateViewExpression, AVAILABLE_FIELDS, AVAILABLE_FUNCTIONS } from './validation.ts';
export { VIEW_FUNCTIONS } from './functions.ts';
