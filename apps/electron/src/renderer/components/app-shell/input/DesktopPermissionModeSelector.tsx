// input: Current permission mode and its session-scoped update callback
// output: Desktop popover for switching the chat execution mode
// pos: Desktop permission control above the free-form input

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  DEFAULT_SLASH_COMMAND_GROUPS,
  SlashCommandMenu,
  type SlashCommandId,
} from '@/components/ui/slash-command-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { PERMISSION_MODE_CONFIG, type PermissionMode } from '@craft-agent/shared/agent/modes'

function PermissionModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
  const config = PERMISSION_MODE_CONFIG[mode]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={config.svgPath} />
    </svg>
  )
}

interface DesktopPermissionModeSelectorProps {
  permissionMode: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  sessionId?: string
}

export function DesktopPermissionModeSelector({
  permissionMode,
  onPermissionModeChange,
  sessionId,
}: DesktopPermissionModeSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [optimisticMode, setOptimisticMode] = React.useState(permissionMode)

  React.useEffect(() => {
    setOptimisticMode(permissionMode)
  }, [permissionMode])

  const handleSelect = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe' || commandId === 'ask' || commandId === 'allow-all') {
      setOptimisticMode(commandId)
      onPermissionModeChange?.(commandId)
    }
    setOpen(false)
  }, [onPermissionModeChange])

  const currentStyle = {
    safe: {
      className: 'bg-foreground/5 text-foreground/60',
      shadowVar: 'var(--foreground-rgb)',
    },
    ask: {
      className: 'bg-info/10 text-info',
      shadowVar: 'var(--info-rgb)',
    },
    'allow-all': {
      className: 'bg-accent/5 text-accent',
      shadowVar: 'var(--accent-rgb)',
    },
  } satisfies Record<PermissionMode, { className: string; shadowVar: string }>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tutorial="permission-mode-dropdown"
          className={cn(
            'h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 shadow-tinted outline-none select-none shrink-0',
            currentStyle[optimisticMode].className,
          )}
          style={{ '--shadow-color': currentStyle[optimisticMode].shadowVar } as React.CSSProperties}
        >
          <PermissionModeIcon mode={optimisticMode} className="h-3.5 w-3.5" />
          <span>{t(`mode.${optimisticMode}`)}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 rounded-[8px] bg-background text-foreground shadow-modal-small"
        side="top"
        align="start"
        sideOffset={4}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
          if (!isTouchDevice) {
            window.dispatchEvent(new CustomEvent('craft:focus-input', {
              detail: { sessionId },
            }))
          }
        }}
      >
        <SlashCommandMenu
          commandGroups={DEFAULT_SLASH_COMMAND_GROUPS}
          activeCommands={[optimisticMode as SlashCommandId]}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  )
}
