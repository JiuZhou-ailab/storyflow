import { memo, useState } from "react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SessionStatusMenu } from "@/components/ui/session-status-menu"
import { getStateIcon, getStateIconStyle } from "@/config/session-status-config"
import type { SessionStatus, SessionStatusId } from "@/config/session-status-config"

interface SessionStatusIconProps {
  sessionId: string
  status: SessionStatusId
  isArchived?: boolean
  sessionStatuses: SessionStatus[]
  onSessionStatusChange: (sessionId: string, state: SessionStatusId) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
}

export const SessionStatusIcon = memo(function SessionStatusIcon({
  sessionId,
  status,
  isArchived,
  sessionStatuses,
  onSessionStatusChange,
  onArchive,
  onUnarchive,
}: SessionStatusIconProps) {
  const [open, setOpen] = useState(false)

  const handleSelect = (state: SessionStatusId) => {
    setOpen(false)
    onSessionStatusChange(sessionId, state)
  }

  return (
    <Popover modal={true} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "!h-5 !w-5 flex items-center justify-center rounded-full transition-colors cursor-pointer",
            "hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "[&>svg]:w-full [&>svg]:h-full [&>img]:w-full [&>img]:h-full [&>span]:text-base",
          )}
          style={getStateIconStyle(status, sessionStatuses)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Change todo state"
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {getStateIcon(status, sessionStatuses)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-0 shadow-none bg-transparent"
        align="start"
        side="bottom"
        sideOffset={4}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <SessionStatusMenu
          activeState={status}
          onSelect={handleSelect}
          states={sessionStatuses}
          isArchived={isArchived}
          onArchive={onArchive ? () => { setOpen(false); onArchive(sessionId) } : undefined}
          onUnarchive={onUnarchive ? () => { setOpen(false); onUnarchive(sessionId) } : undefined}
        />
      </PopoverContent>
    </Popover>
  )
})
