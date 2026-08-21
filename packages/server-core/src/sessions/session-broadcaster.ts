// input: SessionEvent payloads, workspace/global broadcast triggers, and the host EventSink
// output: Workspace-scoped event delivery, deduplicated global broadcasts, and batched text deltas
// pos: Leaf outbound-event module under the SessionManager facade; sole owner of the EventSink reference

import type { EventSink } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS, type SessionEvent, type UnreadSummary } from '@craft-agent/shared/protocol'
import type { LoadedSource } from '@craft-agent/shared/sources'
import { getSessionLog } from './session-runtime'

// Performance: Batch IPC delta events to reduce renderer load
const DELTA_BATCH_INTERVAL_MS = 50  // Flush batched deltas every 50ms

interface PendingDelta {
  delta: string
  turnId?: string
}

export class SessionBroadcaster {
  private eventSink: EventSink | null = null
  private pendingGlobalBroadcasts = new Set<string>()
  // Delta batching for performance - reduces IPC events from 50+/sec to ~20/sec
  private pendingDeltas: Map<string, PendingDelta> = new Map()
  private deltaFlushTimers: Map<string, NodeJS.Timeout> = new Map()

  setEventSink(sink: EventSink): void {
    this.eventSink = sink
  }

  sendEvent(event: SessionEvent, workspaceId?: string): void {
    const sessionLog = getSessionLog()
    if (!this.eventSink) {
      sessionLog.warn('Cannot send event - no event sink')
      return
    }

    if (!workspaceId) {
      sessionLog.warn(`Cannot send ${event.type} event - no workspaceId`)
      return
    }

    this.eventSink(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId }, event)
  }

  /**
   * Queue a text delta for batched sending (performance optimization)
   * Instead of sending 50+ IPC events per second, batches deltas and flushes every 50ms
   */
  queueDelta(sessionId: string, workspaceId: string, delta: string, turnId?: string): void {
    const existing = this.pendingDeltas.get(sessionId)
    if (existing) {
      // Append to existing batch
      existing.delta += delta
      // Keep the latest turnId (should be the same, but just in case)
      if (turnId) existing.turnId = turnId
    } else {
      // Start new batch
      this.pendingDeltas.set(sessionId, { delta, turnId })
    }

    // Schedule flush if not already scheduled
    if (!this.deltaFlushTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        this.flushDelta(sessionId, workspaceId)
      }, DELTA_BATCH_INTERVAL_MS)
      this.deltaFlushTimers.set(sessionId, timer)
    }
  }

  /**
   * Flush any pending deltas for a session (sends batched IPC event)
   * Called on timer or when streaming ends (text_complete)
   */
  flushDelta(sessionId: string, workspaceId: string): void {
    // Clear the timer
    const timer = this.deltaFlushTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.deltaFlushTimers.delete(sessionId)
    }

    // Send batched delta if any
    const pending = this.pendingDeltas.get(sessionId)
    if (pending && pending.delta) {
      this.sendEvent({
        type: 'text_delta',
        sessionId,
        delta: pending.delta,
        turnId: pending.turnId
      }, workspaceId)
      this.pendingDeltas.delete(sessionId)
    }
  }

  /** Drop batched deltas and flush timers for a deleted session. */
  clearSessionDeltas(sessionId: string): void {
    const timer = this.deltaFlushTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.deltaFlushTimers.delete(sessionId)
    }
    this.pendingDeltas.delete(sessionId)
  }

  /** Clear all pending delta state (call on app shutdown). */
  dispose(): void {
    for (const timer of this.deltaFlushTimers.values()) {
      clearTimeout(timer)
    }
    this.deltaFlushTimers.clear()
    this.pendingDeltas.clear()
  }

  private broadcastGlobalOnce(key: string, send: () => void): void {
    if (!this.eventSink || this.pendingGlobalBroadcasts.has(key)) return
    this.pendingGlobalBroadcasts.add(key)
    queueMicrotask(() => {
      this.pendingGlobalBroadcasts.delete(key)
      if (this.eventSink) send()
    })
  }

  broadcastSourcesChanged(workspaceId: string, sources: LoadedSource[]): void {
    if (!this.eventSink) return
    this.eventSink(RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
  }

  broadcastStatusesChanged(workspaceId: string): void {
    if (!this.eventSink) return
    getSessionLog().info(`Broadcasting statuses changed for ${workspaceId}`)
    this.eventSink(RPC_CHANNELS.statuses.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  broadcastLabelsChanged(workspaceId: string): void {
    if (!this.eventSink) return
    getSessionLog().info(`Broadcasting labels changed for ${workspaceId}`)
    this.eventSink(RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  broadcastAutomationsChanged(workspaceId: string): void {
    if (!this.eventSink) return
    getSessionLog().info(`Broadcasting automations changed for ${workspaceId}`)
    this.eventSink(RPC_CHANNELS.automations.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  broadcastAppThemeChanged(theme: import('@craft-agent/shared/config').ThemeOverrides | null): void {
    this.broadcastGlobalOnce(RPC_CHANNELS.theme.APP_CHANGED, () => {
      getSessionLog().info(`Broadcasting app theme changed`)
      this.eventSink?.(RPC_CHANNELS.theme.APP_CHANGED, { to: 'all' }, theme)
    })
  }

  broadcastLlmConnectionsChanged(): void {
    this.broadcastGlobalOnce(RPC_CHANNELS.llmConnections.CHANGED, () => {
      getSessionLog().info('Broadcasting LLM connections changed')
      this.eventSink?.(RPC_CHANNELS.llmConnections.CHANGED, { to: 'all' })
    })
  }

  broadcastSkillsChanged(workspaceId: string): void {
    if (!this.eventSink) return
    getSessionLog().info('Broadcasting skills changed')
    this.eventSink(RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  broadcastDefaultPermissionsChanged(): void {
    this.broadcastGlobalOnce(RPC_CHANNELS.permissions.DEFAULTS_CHANGED, () => {
      getSessionLog().info('Broadcasting default permissions changed')
      this.eventSink?.(RPC_CHANNELS.permissions.DEFAULTS_CHANGED, { to: 'all' }, null)
    })
  }

  /** Broadcast the aggregated unread summary to all workspace windows. */
  broadcastUnreadSummaryChanged(summary: UnreadSummary): void {
    if (!this.eventSink) return
    this.eventSink(RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED, { to: 'all' }, summary)
  }
}
