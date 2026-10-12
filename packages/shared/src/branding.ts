/**
 * Centralized branding assets for Craft Agent
 * Used by OAuth callback pages
 */

export const CRAFT_LOGO = [
  '  ████████ █████████    ██████   ██████████ ██████████',
  '██████████ ██████████ ██████████ █████████  ██████████',
  '██████     ██████████ ██████████ ████████   ██████████',
  '██████████ ████████   ██████████ ███████      ██████  ',
  '  ████████ ████  ████ ████  ████ █████        ██████  ',
] as const;

/** Logo as a single string for HTML templates */
export const CRAFT_LOGO_HTML = CRAFT_LOGO.map((line) => line.trimEnd()).join('\n');

/** Storyflow's own site; the docs live under /docs/. */
export const STORYFLOW_SITE_URL = 'https://story.zjding.com';

/** Legacy share cleanup only; remove when stored sharedIds no longer need cleanup or an owned sharing service replaces it. */
export const LEGACY_SHARE_CLEANUP_URL = 'https://agents.craft.do';
