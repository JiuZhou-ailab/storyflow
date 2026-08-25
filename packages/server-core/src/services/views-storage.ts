// input: Workspace root paths, shared view type contracts, and legacy smartLabels configs
// output: views.json persistence — load/save/list/saveViews plus default view seeding
// pos: Server-side persistence half of the views subdomain; expression engines live per host

/**
 * Views Storage
 *
 * Filesystem-based storage for workspace view configurations.
 * Views are stored at {workspaceRootPath}/.craft-agent/views.json
 *
 * Views are dynamic, expression-based filters computed at runtime from session state.
 * They are never persisted on sessions — purely runtime-evaluated.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { ViewConfig } from '@craft-agent/shared/views';
import { debug, readJsonFileSync } from '@craft-agent/shared/utils';
import {
  getExistingWorkspaceLabelConfigPath,
  getExistingWorkspaceViewsPath,
  getWorkspaceViewsPath,
} from '@craft-agent/shared/workspaces';

/**
 * Views configuration file structure.
 */
export interface ViewsConfig {
  /** Schema version */
  version: number;
  /** Array of view definitions */
  views: ViewConfig[];
}

const MAX_VIEWS = 100;
const MAX_VIEW_NAME_LENGTH = 256;
const MAX_VIEW_DESCRIPTION_LENGTH = 1024;
const MAX_VIEW_EXPRESSION_LENGTH = 4096;
const MAX_VIEWS_FILE_BYTES = 1024 * 1024;

function validateViews(views: unknown): asserts views is ViewConfig[] {
  if (!Array.isArray(views) || views.length > MAX_VIEWS) {
    throw new Error(`Views config exceeds the limit of ${MAX_VIEWS} views`);
  }

  for (const view of views) {
    if (!view || typeof view !== 'object') throw new Error('Views config contains an invalid view');
    const candidate = view as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || candidate.id.length === 0
      || candidate.id.length > MAX_VIEW_NAME_LENGTH
      || typeof candidate.name !== 'string'
      || candidate.name.length > MAX_VIEW_NAME_LENGTH
      || (candidate.description !== undefined
        && (typeof candidate.description !== 'string' || candidate.description.length > MAX_VIEW_DESCRIPTION_LENGTH))
      || typeof candidate.expression !== 'string'
      || candidate.expression.length === 0
      || candidate.expression.length > MAX_VIEW_EXPRESSION_LENGTH
    ) {
      throw new Error('Views config contains an invalid view');
    }
  }
}

/**
 * Default views seeded into views.json.
 * Built-in views provided to new workspaces (or when views.json is missing).
 * Users can modify or remove these — they're just the starting point.
 */
export function getDefaultViews(): ViewConfig[] {
  return [
    {
      id: 'view-new',
      name: 'New',
      description: 'Sessions with unread messages',
      color: 'accent',
      expression: 'hasUnread == true',
    },
    {
      id: 'view-plan',
      name: 'Plan',
      description: 'Sessions with a pending plan awaiting approval',
      color: 'info',
      expression: 'hasPendingPlan == true',
    },
    {
      id: 'view-explore',
      name: 'Explore',
      description: 'Sessions in Explore (read-only) mode',
      color: 'foreground/50',
      expression: 'permissionMode == "safe"',
    },
    {
      id: 'view-processing',
      name: 'Processing',
      description: 'Sessions where the agent is currently running',
      color: 'success',
      expression: 'isProcessing == true',
    },
  ];
}

/**
 * Load views configuration from workspace.
 * Returns default views if no file exists or parsing fails.
 * Also handles migration from old labels/config.json smartLabels key.
 */
export function loadViewsConfig(workspaceRootPath: string): ViewsConfig {
  const configPath = getExistingWorkspaceViewsPath(workspaceRootPath);

  // If no views.json exists, check for legacy smartLabels in labels/config.json
  // and migrate them. Otherwise seed with defaults.
  if (!existsSync(configPath)) {
    const migrated = migrateFromSmartLabels(workspaceRootPath);
    if (migrated) {
      debug('[loadViewsConfig] Migrated from legacy smartLabels');
      return migrated;
    }

    // No legacy data — seed with defaults
    const defaults: ViewsConfig = { version: 1, views: getDefaultViews() };
    debug('[loadViewsConfig] No config found, seeding with default views');
    saveViewsConfig(workspaceRootPath, defaults);
    return defaults;
  }

  try {
    if (statSync(configPath).size > MAX_VIEWS_FILE_BYTES) {
      throw new Error('Views config exceeds 1 MB');
    }
    const config = readJsonFileSync<ViewsConfig>(configPath);
    validateViews(config.views);
    return config;
  } catch (error) {
    debug('[loadViewsConfig] Failed to parse config:', error);
    return { version: 1, views: getDefaultViews() };
  }
}

/**
 * Save views configuration to disk.
 */
export function saveViewsConfig(
  workspaceRootPath: string,
  config: ViewsConfig
): void {
  const configPath = getWorkspaceViewsPath(workspaceRootPath);

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveViewsConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * List views for a workspace.
 * Returns the views array from config (seeded with defaults if missing).
 */
export function listViews(workspaceRootPath: string): ViewConfig[] {
  const config = loadViewsConfig(workspaceRootPath);
  return config.views ?? [];
}

/**
 * Save views to the workspace config.
 * Replaces the entire views array.
 */
export function saveViews(
  workspaceRootPath: string,
  views: ViewConfig[]
): void {
  validateViews(views);
  const config = loadViewsConfig(workspaceRootPath);
  config.views = views;
  saveViewsConfig(workspaceRootPath, config);
}

/**
 * Migrate legacy smartLabels from labels/config.json to views.json.
 * Renames IDs from "smart-*" to "view-*" prefix.
 * Returns the migrated config if migration occurred, null otherwise.
 */
function migrateFromSmartLabels(workspaceRootPath: string): ViewsConfig | null {
  const labelsConfigPath = getExistingWorkspaceLabelConfigPath(workspaceRootPath);
  if (!existsSync(labelsConfigPath)) return null;

  try {
    const labelsConfig = readJsonFileSync<Record<string, any>>(labelsConfigPath);
    if (!labelsConfig.smartLabels || !Array.isArray(labelsConfig.smartLabels)) return null;

    // Migrate: rename IDs from smart-* to view-*
    const views: ViewConfig[] = labelsConfig.smartLabels.map((sl: any) => ({
      ...sl,
      id: sl.id?.startsWith('smart-') ? sl.id.replace('smart-', 'view-') : sl.id,
    }));

    const config: ViewsConfig = { version: 1, views };
    saveViewsConfig(workspaceRootPath, config);

    // Remove smartLabels from labels config to avoid confusion
    delete labelsConfig.smartLabels;
    writeFileSync(labelsConfigPath, JSON.stringify(labelsConfig, null, 2), 'utf-8');

    return config;
  } catch {
    return null;
  }
}
