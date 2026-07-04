import { createContext, useContext } from "react"
import type { LabelConfig } from "@craft-agent/shared/labels"
import type { SessionStatusId, SessionStatus } from "@/config/session-status-config"
import type { SessionMeta } from "@/atoms/sessions"

export interface SessionListContextValue {
  // Session action callbacks (shared across all items)
  onRenameClick: (sessionId: string, currentName: string) => void
  onSessionStatusChange: (sessionId: string, state: SessionStatusId) => void
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  onOpenInNewWindow: (item: SessionMeta) => void
  onSendToWorkspace?: (sessionIds: string[]) => void
  onFocusZone: () => void
  onKeyDown: (e: React.KeyboardEvent, item: SessionMeta) => void

  // Shared config
  sessionStatuses: SessionStatus[]
  labelById: Map<string, LabelConfig>
  labels: LabelConfig[]
  isMultiSelectActive: boolean
  isCompactMode?: boolean
  hasRemoteWorkspaces?: boolean
}

const SessionListContext = createContext<SessionListContextValue | null>(null)

export function useSessionListContext(): SessionListContextValue {
  const ctx = useContext(SessionListContext)
  if (!ctx) throw new Error("useSessionListContext must be used within SessionList")
  return ctx
}

export const SessionListProvider = SessionListContext.Provider
