// input: ManagedSession entries (workspace root + id) and the stored pending-plan-execution persistence API
// output: Accept-and-compact bookkeeping — set/mark-dispatched/mark-compacted/clear/read of pending plan state
// pos: Stateless plan-tracking functions under the SessionManager facade; the Facade owns registry lookup and the ISessionManager surface

import {
  setPendingPlanExecution as setStoredPendingPlanExecution,
  markCompactionComplete as markStoredCompactionComplete,
  markPendingPlanExecutionDispatched as markStoredPendingPlanExecutionDispatched,
  clearPendingPlanExecution as clearStoredPendingPlanExecution,
  getPendingPlanExecution as getStoredPendingPlanExecution,
} from '@craft-agent/shared/sessions'
import type { ManagedSession } from './managed-session'
import { getSessionLog } from './session-runtime'

export interface PendingPlanExecutionState {
  planPath: string
  draftInputSnapshot?: string
  awaitingCompaction: boolean
  executionDispatched: boolean
}

/**
 * Set pending plan execution state.
 * Called when user clicks "Accept & Compact" to persist the plan path
 * so execution can resume after compaction (even if page reloads).
 */
export async function setPendingPlanExecution(
  managed: ManagedSession,
  planPath: string,
  draftInputSnapshot?: string
): Promise<void> {
  await setStoredPendingPlanExecution(managed.workspace.rootPath, managed.id, planPath, draftInputSnapshot)
  getSessionLog().info(`Session ${managed.id}: set pending plan execution for ${planPath}`)
}

/**
 * Mark compaction as complete for pending plan execution.
 * Called when compaction_complete event fires - allows reload recovery
 * to know that compaction finished and plan can be executed.
 */
export async function markCompactionComplete(managed: ManagedSession): Promise<void> {
  await markStoredCompactionComplete(managed.workspace.rootPath, managed.id)
  getSessionLog().info(`Session ${managed.id}: compaction marked complete for pending plan`)
}

/**
 * Mark pending plan execution as already dispatched from the UI.
 * This prevents reload recovery from double-submitting the same plan if
 * sending succeeded but cleanup failed due a reconnect/disconnect.
 */
export async function markPendingPlanExecutionDispatched(managed: ManagedSession): Promise<void> {
  await markStoredPendingPlanExecutionDispatched(managed.workspace.rootPath, managed.id)
  getSessionLog().info(`Session ${managed.id}: marked pending plan execution as dispatched`)
}

/**
 * Clear pending plan execution state.
 * Called after plan execution is triggered, on new user message,
 * or when the pending execution is no longer relevant.
 */
export async function clearPendingPlanExecution(managed: ManagedSession): Promise<void> {
  await clearStoredPendingPlanExecution(managed.workspace.rootPath, managed.id)
  getSessionLog().info(`Session ${managed.id}: cleared pending plan execution`)
}

/**
 * Get pending plan execution state for a session.
 * Used on reload/init to check if we need to resume plan execution.
 */
export function getPendingPlanExecution(managed: ManagedSession): PendingPlanExecutionState | null {
  return getStoredPendingPlanExecution(managed.workspace.rootPath, managed.id)
}
