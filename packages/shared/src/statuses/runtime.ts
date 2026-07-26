// input: Observable per-session agent signals (in-flight flag, outstanding prompts, last message role)
// output: A single derived runtime status describing what the agent is objectively doing
// pos: The factual axis of session state, orthogonal to the user-authored Kanban status

/**
 * Sessions carry two orthogonal kinds of state:
 *
 * - **Kanban status** (`StatusConfig` in `./types.ts`) is the *human's intent* —
 *   what the user wants this task to be. It is authored by hand and the system
 *   must never overwrite it.
 * - **Runtime status** (this module) is the *system's fact* — what the agent is
 *   actually doing right now. It is derived, never authored.
 *
 * Collapsing the two loses a dimension: an agent can have finished while the
 * user still considers the task `todo`, and a task marked `done` can have a
 * turn that ended in an error. Attention priority is a join of both axes, which
 * is only expressible if both exist.
 *
 * Before this module the factual axis had no name — it was scattered across
 * independent booleans that each view re-combined ad hoc, which is why an
 * errored session was indistinguishable from a completed one.
 */
export type SessionRuntimeStatus =
  /** Blocked on a human decision; no progress until someone acts. */
  | 'waiting-input'
  /** Agent is actively working; no human action required. */
  | 'running'
  /** The last turn ended in an error and nothing is in flight. */
  | 'error'
  /** Nothing in flight and nothing outstanding. */
  | 'idle'

export interface SessionRuntimeSignals {
  /** Whether an agent turn is currently in flight. */
  isProcessing?: boolean
  /** Whether a permission or credential request is awaiting a response. */
  hasPendingPrompt?: boolean
  /** Role of the last message, used to detect a plan awaiting approval or a failed turn. */
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error'
}

/**
 * A trailing `plan` message means the agent proposed a plan and stopped for
 * approval — approving sends a new user message, so the role only stays `plan`
 * while the decision is still outstanding. That makes it a deterministic
 * "waiting on a human" signal, not a heuristic.
 */
function isAwaitingHumanDecision(signals: SessionRuntimeSignals): boolean {
  return signals.hasPendingPrompt === true || signals.lastMessageRole === 'plan'
}

/**
 * Derives the runtime status from raw signals.
 *
 * Priority order, highest first, and why:
 *
 * 1. `waiting-input` — outranks everything because the session is *blocked*.
 *    `isProcessing` stays true while a mid-turn permission prompt is
 *    outstanding, so without this precedence a blocked session would render as
 *    healthy progress and stall unnoticed.
 * 2. `running` — outranks `error` because a turn in flight makes any earlier
 *    error historical; reporting the stale error would misdescribe the present.
 * 3. `error` — surfaced only once nothing is in flight, so a failed turn stops
 *    being invisible.
 * 4. `idle` — nothing in flight, nothing outstanding.
 */
export function deriveSessionRuntimeStatus(signals: SessionRuntimeSignals): SessionRuntimeStatus {
  if (isAwaitingHumanDecision(signals)) return 'waiting-input'
  if (signals.isProcessing === true) return 'running'
  if (signals.lastMessageRole === 'error') return 'error'
  return 'idle'
}

/**
 * Whether this status needs a human to act before the session can progress.
 *
 * `error` counts: the work has stopped and only a human can decide what
 * happens next.
 */
export function requiresHumanAttention(status: SessionRuntimeStatus): boolean {
  return status === 'waiting-input' || status === 'error'
}
