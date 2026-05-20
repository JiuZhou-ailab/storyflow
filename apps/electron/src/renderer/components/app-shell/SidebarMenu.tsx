// input: Context menu request from the new-session header button
// output: Menu content for opening a new session in a focused window
// pos: Small shared menu used by ChatPage header actions

import { AppWindow } from 'lucide-react'
import { useTranslation } from "react-i18next"

import { useMenuComponents } from '@/components/ui/menu-context'

export interface SidebarMenuProps {
  type: 'newSession'
}

export function SidebarMenu({ type }: SidebarMenuProps) {
  const { t } = useTranslation()
  const { MenuItem } = useMenuComponents()

  if (type !== 'newSession') return null

  return (
    <MenuItem onClick={() => window.electronAPI.openUrl('craftagents://action/new-session?window=focused')}>
      <AppWindow className="h-3.5 w-3.5" />
      <span className="flex-1">{t("sidebarMenu.openInNewWindow")}</span>
    </MenuItem>
  )
}
