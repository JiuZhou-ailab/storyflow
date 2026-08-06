// input: Settings registry, selected subpage, and overlay lifecycle callbacks
// output: Settings category navigation plus the responsive settings dialog
// pos: Renderer utility surface that keeps settings outside the workspace panel stack

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, AppWindow, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { DropdownMenuProvider } from '@/components/ui/menu-context'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { SettingsSubpage } from '../../../shared/types'
import { SETTINGS_ITEMS } from '../../../shared/menu-schema'
import { SETTINGS_ICONS } from '@/components/icons/SettingsIcons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { getSettingsPageComponent } from './settings-pages'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'navigator',
}

interface SettingsNavigatorProps {
  /** Currently selected settings subpage */
  selectedSubpage: SettingsSubpage
  /** Called when a subpage is selected */
  onSelectSubpage: (subpage: SettingsSubpage) => void
  availableSubpages?: readonly SettingsSubpage[]
}

interface SettingsItem {
  id: SettingsSubpage
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

interface SettingsItemRowProps {
  item: SettingsItem
  isSelected: boolean
  isFirst: boolean
  onSelect: () => void
}

/**
 * SettingsItemRow - Individual settings item with dropdown menu
 * Tracks menu open state to keep "..." button visible when menu is open
 */
function SettingsItemRow({ item, isSelected, isFirst, onSelect }: SettingsItemRowProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const Icon = item.icon

  // Open settings page in a new window via deep link
  const handleOpenInNewWindow = () => {
    window.electronAPI.openUrl(`craftagents://settings/${item.id}?window=focused`)
  }

  return (
    <div className="settings-item" data-selected={isSelected || undefined}>
      {/* Separator - only show if not first */}
      {!isFirst && (
        <div className="settings-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      {/* Wrapper for button with proper margins */}
      <div className="settings-content relative group select-none pl-2 mr-2">
        {/* Icon - positioned absolutely for consistent alignment */}
        <div className="absolute left-[20px] top-[14px] z-10">
          <Icon
            className={cn(
              'w-4 h-4 shrink-0',
              isSelected ? 'text-foreground' : 'text-muted-foreground'
            )}
          />
        </div>
        {/* Main content button */}
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm outline-none rounded-[8px]',
            // Fast hover transition (75ms vs default 150ms)
            'transition-[background-color] duration-75',
            isSelected
              ? 'bg-foreground/5 hover:bg-foreground/7'
              : 'hover:bg-foreground/2'
          )}
        >
          {/* Spacer for icon */}
          <div className="w-6 h-5 shrink-0" />
          {/* Content column */}
          <div className="flex flex-col min-w-0 flex-1">
            <span
              className={cn(
                'font-medium',
                isSelected ? 'text-foreground' : 'text-foreground/80'
              )}
            >
              {item.label}
            </span>
            <span className="text-xs text-foreground/60 line-clamp-1">
              {item.description}
            </span>
          </div>
        </button>
        {/* Action buttons - visible on hover or when menu is open */}
        <div
          className={cn(
            'absolute right-2 top-2 transition-opacity z-10',
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <DropdownMenuProvider>
                  <StyledDropdownMenuItem onClick={handleOpenInNewWindow}>
                    <AppWindow className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("sessionMenu.openInNewWindow")}</span>
                  </StyledDropdownMenuItem>
                </DropdownMenuProvider>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SettingsNavigator({
  selectedSubpage,
  onSelectSubpage,
  availableSubpages,
}: SettingsNavigatorProps) {
  const { t } = useTranslation()

  const settingsItems: SettingsItem[] = useMemo(() =>
    SETTINGS_ITEMS
      .filter(item => !availableSubpages || availableSubpages.includes(item.id))
      .map((item) => ({
      id: item.id,
      label: t(item.labelKey),
      icon: SETTINGS_ICONS[item.id],
      description: t(item.descriptionKey),
    })),
    [availableSubpages, t]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="pt-2">
          {settingsItems.map((item, index) => (
            <SettingsItemRow
              key={item.id}
              item={item}
              isSelected={selectedSubpage === item.id}
              isFirst={index === 0}
              onSelect={() => onSelectSubpage(item.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface SettingsDialogProps {
  open: boolean
  selectedSubpage: SettingsSubpage
  onSelectSubpage: (subpage: SettingsSubpage) => void
  onClose: () => void
  availableSubpages?: readonly SettingsSubpage[]
}

export function SettingsDialog({
  open,
  selectedSubpage,
  onSelectSubpage,
  onClose,
  availableSubpages,
}: SettingsDialogProps) {
  const { t } = useTranslation()
  const SettingsPageComponent = getSettingsPageComponent(selectedSubpage)

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        className="h-[85vh] max-h-[900px] w-[min(960px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none max-[1023px]:left-0 max-[1023px]:top-0 max-[1023px]:h-full max-[1023px]:max-h-none max-[1023px]:w-full max-[1023px]:max-w-none max-[1023px]:translate-x-0 max-[1023px]:translate-y-0 max-[1023px]:rounded-none"
      >
        <DialogTitle className="sr-only">{t('sidebar.settings')}</DialogTitle>
        <DialogDescription className="sr-only">配置 Storyflow 应用与工作区偏好</DialogDescription>
        <div className="flex h-full min-h-0">
          <aside className="flex w-[280px] shrink-0 flex-col border-r border-border/60 bg-foreground-2 max-[720px]:w-[220px]">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
              <h2 className="text-[14px] font-semibold text-foreground">{t('sidebar.settings')}</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg"
                onClick={onClose}
                aria-label={t('common.close')}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <SettingsNavigator
                selectedSubpage={selectedSubpage}
                onSelectSubpage={onSelectSubpage}
                availableSubpages={availableSubpages}
              />
            </div>
          </aside>
          <main className="min-w-0 flex-1 bg-background">
            <SettingsPageComponent />
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}
