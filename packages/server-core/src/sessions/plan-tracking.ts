// input: Session registry lookups and the stored pending-plan-execution persistence API
// output: Accept-and-compact bookkeeping — set/mark-dispatched/mark-compacted/clear/read of pending plan state
// pos: Plan-tracking storage wrapper under the SessionManager facade; handlePlanSubmitted stays in the Facade

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

export interface PlanTrackingDeps {
  /** Registry lookup — identity-checked by callers via the shared sessions map. */
  getSession: (sessionId: string) => ManagedSession | undefined
}

export class PlanTracking {
  constructor(private deps: PlanTrackingDeps) {}

  /**
   * Set pending plan execution state.
   * Called when user clicks "Accept & Compact" to persist the plan path
   * so execution can resume after compaction (even if page reloads).
   */
  async setPendingPlanExecution(sessionId: string, planPath: string, draftInputSnapshot?: string): Promise<void> {
    const managed = this.deps.getSession(sessionId)
    if (managed) {
      await setStoredPendingPlanExecution(managed.workspace.rootPath, sessionId, planPath, draftInputSnapshot)
      getSessionLog().info(`Session ${sessionId}: set pending plan execution for ${planPath}`)
    }
  }

  /**
   * Mark compaction as complete for pending plan execution.
   * Called when compaction_complete event fires - allows reload recovery
   * to know that compaction finished and plan can be executed.
   */
  async markCompactionComplete(sessionId: string): Promise<void> {
    const managed = this.deps.getSession(sessionId)
    if (managed) {
      await markStoredCompactionComplete(managed.workspace.rootPath, sessionId)
      getSessionLog().info(`Session ${sessionId}: compaction marked complete for pending plan`)
    }
  }

  /**
   * Mark pending plan execution as already dispatched from the UI.
   * This prevents reload recovery from double-submitting the same plan if
   * sending succeeded but cleanup failed due a reconnect/disconnect.
   */
  async markPendingPlanExecutionDispatched(sessionId: string): Promise<void> {
    const managed = this.deps.getSession(sessionId)
    if (managed) {
      await markStoredPendingPlanExecutionDispatched(managed.workspace.rootPath, sessionId)
      getSessionLog().info(`Session ${sessionId}: marked pending plan execution as dispatched`)
    }
  }

  /**
   * Clear pending plan execution state.
   * Called after plan execution is triggered, on new user message,
   * or when the pending execution is no longer relevant.
   */
  async clearPendingPlanExecution(sessionId: string): Promise<void> {
    const managed = this.deps.getSession(sessionId)
    if (managed) {
      await clearStoredPendingPlanExecution(managed.workspace.rootPath, sessionId)
      getSessionLog().info(`Session ${sessionId}: cleared pending plan execution`)
    }
  }

  /**
   * Get pending plan execution state for a session.
   * Used on reload/init to check if we need to resume plan execution.
   */
  getPendingPlanExecution(sessionId: string): PendingPlanExecutionState | null {
    const managed = this.deps.getSession(sessionId)
    if (!managed) return null
    return getStoredPendingPlanExecution(managed.workspace.rootPath, sessionId)
  }
}
