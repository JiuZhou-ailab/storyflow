// input: Workspace status configuration and an ordered status ID list
// output: Persisted status display order
// pos: Backend mutation boundary for the only exposed status write operation

import { loadStatusConfig, saveStatusConfig } from './storage.ts';

/**
 * Reorder statuses.
 */
export function reorderStatuses(
  workspaceRootPath: string,
  orderedIds: string[]
): void {
  const config = loadStatusConfig(workspaceRootPath);

  // Validate all IDs exist
  const validIds = new Set(config.statuses.map(s => s.id));
  for (const id of orderedIds) {
    if (!validIds.has(id)) {
      throw new Error(`Invalid status ID: ${id}`);
    }
  }

  // Update order based on array position
  for (let i = 0; i < orderedIds.length; i++) {
    const status = config.statuses.find(s => s.id === orderedIds[i]);
    if (status) {
      status.order = i;
    }
  }

  saveStatusConfig(workspaceRootPath, config);
}
