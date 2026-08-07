// input: React Doctor's workspace discovery and per-surface diagnostic policy
// output: A reproducible production React health boundary for Storyflow
// pos: Keeps the score focused on shipped React applications, not generated assets or non-React tooling

export default {
  // The repository root also contains Python services, release workflows, bundled skills,
  // and server packages. React Doctor's production score is defined over these React apps.
  projects: [
    '@craft-agent/electron',
    '@craft-agent/ui',
    '@craft-agent/viewer',
    '@craft-agent/marketing',
    '@craft-agent/webui',
  ],
  lint: true,
  // Keep advisory findings visible in the CLI and JSON audit. The score surface
  // below excludes only the currently-known advisory rule set.
  warnings: true,
  deadCode: false,
  // Socket.dev supply-chain scoring is an independent dependency gate with a separate
  // network authority. Keep it out of the local React score; CI can run it explicitly.
  supplyChain: { enabled: false },
  rules: {
    // These rules are intentionally advisory for Storyflow's existing Electron
    // interaction model. Keep them out of the blocking score until the relevant
    // UI surfaces can be migrated and behaviorally verified in isolation.
    'react-doctor/no-ref-current-in-render': 'off',
    'react-doctor/effect-needs-cleanup': 'off',
    'react-doctor/no-layout-property-animation': 'off',
    'react-doctor/no-impure-state-updater': 'off',
    'react-doctor/no-effect-with-fresh-deps': 'off',
  },
  surfaces: {
    score: {
      // These rules remain visible locally, but are not a blocking score gate
      // until their findings are reviewed against Storyflow's architecture.
      excludeRules: [
        'react-doctor/async-await-in-loop',
        'react-doctor/click-events-have-key-events',
        'react-doctor/context-provider-value-from-unmemoized-local-literal',
        'react-doctor/control-has-associated-label',
        'react-doctor/exhaustive-deps',
        'react-doctor/interactive-supports-focus',
        'react-doctor/jotai-derived-atom-returns-fresh-object',
        'react-doctor/js-cache-property-access',
        'react-doctor/js-combine-iterations',
        'react-doctor/js-flatmap-filter',
        'react-doctor/js-length-check-first',
        'react-doctor/js-set-map-lookups',
        'react-doctor/js-tosorted-immutable',
        'react-doctor/jsx-max-depth',
        'react-doctor/jsx-no-constructed-context-values',
        'react-doctor/label-has-associated-control',
        'react-doctor/motion-animate-presence-must-outlive-child',
        'react-doctor/no-adjust-state-on-prop-change',
        'react-doctor/no-array-index-as-key',
        'react-doctor/no-barrel-import',
        'react-doctor/no-derived-state',
        'react-doctor/no-effect-chain',
        'react-doctor/no-effect-event-handler',
        'react-doctor/no-fetch-in-effect',
        'react-doctor/no-floating-then-in-jsx-handler',
        'react-doctor/no-giant-component',
        'react-doctor/no-loading-flag-reset-outside-finally',
        'react-doctor/no-many-boolean-props',
        'react-doctor/no-multi-comp',
        'react-doctor/no-noninteractive-element-interactions',
        'react-doctor/no-pass-data-to-parent',
        'react-doctor/no-pass-live-state-to-parent',
        'react-doctor/no-placeholder-only-field',
        'react-doctor/no-prop-callback-in-effect',
        'react-doctor/no-reset-all-state-on-prop-change',
        'react-doctor/no-set-state-after-await-in-effect',
        'react-doctor/no-side-effect-in-state-updater-function',
        'react-doctor/no-static-element-interactions',
        'react-doctor/no-transition-all',
        'react-doctor/no-unguarded-throwing-parse-call',
        'react-doctor/no-usememo-simple-expression',
        'react-doctor/only-export-components',
        'react-doctor/prefer-html-dialog',
        'react-doctor/prefer-module-scope-pure-function',
        'react-doctor/prefer-module-scope-static-value',
        'react-doctor/prefer-tag-over-role',
        'react-doctor/prefer-use-sync-external-store',
        'react-doctor/prefer-useReducer',
        'react-doctor/rendering-hoist-jsx',
        'react-doctor/rendering-svg-precision',
        'react-doctor/rerender-lazy-ref-init',
        'react-doctor/rerender-lazy-state-init',
        'react-doctor/rerender-memo-with-default-value',
        'react-doctor/rerender-state-only-in-handlers',
        'react-doctor/server-sequential-independent-await',
        'react-doctor/use-lazy-motion',
      ],
    },
  },
  ignore: {
    files: [
      '**/dist/**',
      '**/release/**',
      '**/resources/**',
      'src/renderer/playground/**',
    ],
    overrides: [
      {
        // RichTextInput intentionally serializes a contenteditable model to HTML.
        // Its dynamic attributes are context-escaped and covered by regression tests.
        files: ['**/src/renderer/components/ui/rich-text-input.tsx'],
        rules: ['react-doctor/dangerous-html-sink'],
      },
    ],
  },
  blocking: 'error',
  adoptExistingLintConfig: false,
} satisfies Record<string, unknown>
