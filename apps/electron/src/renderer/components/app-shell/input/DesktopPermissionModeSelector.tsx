// input: Current permission mode and its session-scoped update callback
// output: Desktop toolbar popover for switching the chat execution mode
// pos: Permission control beside the source selector in the free-form input toolbar

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
  const shortName = t(`mode.${permissionMode}`)

  const handleSelect = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe' || commandId === 'ask' || commandId === 'allow-all') {
      onPermissionModeChange?.(commandId)
    }
    setOpen(false)
  }, [onPermissionModeChange])

  const currentColor = {
    safe: 'text-foreground/60',
    ask: 'text-info',
    'allow-all': 'text-accent',
  } satisfies Record<PermissionMode, string>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tutorial="permission-mode-dropdown"
          aria-label={t('mode.permissionAria', { mode: shortName })}
          className={cn(
            'input-toolbar-btn flex h-7 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[12px] font-medium outline-none transition-colors hover:bg-foreground/[0.07] active:bg-foreground/10 focus-visible:ring-1 focus-visible:ring-ring',
            currentColor[permissionMode],
          )}
        >
          <PermissionModeIcon mode={permissionMode} className="h-3.5 w-3.5" />
          <span>{shortName}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
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
          activeCommands={[permissionMode as SlashCommandId]}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  )
}
