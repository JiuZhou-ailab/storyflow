// input: Current permission mode and its session-scoped update callback
// output: Compact drawer for switching the chat execution mode
// pos: Compact permission control inside the free-form input toolbar

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import {
  PERMISSION_MODE_CONFIG,
  PERMISSION_MODE_ORDER,
  type PermissionMode,
} from '@craft-agent/shared/agent/modes'

// ============================================================================
// Mode Icon (same SVG pattern as ActiveOptionBadges.PermissionModeIcon)
// ============================================================================

function ModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
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

// ============================================================================
// Trigger chip styling per mode (matches desktop PermissionModeDropdown)
// ============================================================================

const MODE_STYLES: Record<PermissionMode, { className: string; shadowVar: string }> = {
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
}

const MODE_DESC_KEYS: Record<PermissionMode, string> = {
  safe: 'mode.exploreFullDesc',
  ask: 'mode.askFullDesc',
  'allow-all': 'mode.executeFullDesc',
}

// ============================================================================
// Component
// ============================================================================

interface CompactPermissionModeSelectorProps {
  permissionMode: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
}

export function CompactPermissionModeSelector({
  permissionMode,
  onPermissionModeChange,
}: CompactPermissionModeSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const handleSelect = React.useCallback((mode: PermissionMode) => {
    onPermissionModeChange?.(mode)
    setOpen(false)
  }, [onPermissionModeChange])

  const shortName = t(`mode.${permissionMode}`)
  const style = MODE_STYLES[permissionMode]

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label={t('mode.permissionAria', { mode: shortName })}
          className={cn(
            "h-7 pl-2 pr-2.5 text-xs font-medium rounded-[6px] flex items-center gap-1.5 shadow-tinted outline-none select-none shrink-0",
            style.className,
          )}
          style={{ '--shadow-color': style.shadowVar } as React.CSSProperties}
        >
          <ModeIcon mode={permissionMode} className="h-3.5 w-3.5" />
          <span>{shortName}</span>
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('mode.permissionTitle')}</DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-6 flex flex-col gap-1">
          {PERMISSION_MODE_ORDER.map((mode) => {
            const isSelected = mode === permissionMode
            return (
              <DrawerClose asChild key={mode}>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-3 w-full px-3 py-3 rounded-lg text-left transition-colors",
                    isSelected ? "bg-foreground/5" : "hover:bg-foreground/5",
                  )}
                  onClick={() => handleSelect(mode)}
                >
                  <span className={cn("shrink-0", PERMISSION_MODE_CONFIG[mode].colorClass.text)}>
                    <ModeIcon mode={mode} className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t(`mode.${mode}`)}</div>
                    <div className="text-xs text-muted-foreground">{t(MODE_DESC_KEYS[mode])}</div>
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-foreground/60" />
                  )}
                </button>
              </DrawerClose>
            )
          })}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
