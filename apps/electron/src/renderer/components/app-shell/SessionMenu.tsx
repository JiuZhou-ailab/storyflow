// input: Session metadata and rename/archive/delete callbacks
// output: Conversation actions and existing share link access/revocation in dropdown/context menus
// pos: Single source of truth for essential conversation actions across shell surfaces

/**
 * SessionMenu - Shared menu content for session actions
 *
 * Used by:
 * - SessionList (dropdown via "..." button, context menu via right-click)
 * - ChatPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides only essential session actions:
 * - Existing share links and revocation
 * - Rename
 * - Archive / Unarchive
 * - Delete
 */

import { useTranslation } from "react-i18next"
import {
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  CloudUpload,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { ShareMenuItems } from './SessionMenuParts'
import type { SessionMeta } from '@/atoms/sessions'

export interface SessionMenuProps {
  /** Session data — display state is derived from this */
  item: SessionMeta
  onRename: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}

/**
 * SessionMenu - Renders the menu items for session actions
 * This is the content only, not wrapped in a DropdownMenu
 */
export function SessionMenu({
  item,
  onRename,
  onArchive,
  onUnarchive,
  onDelete,
}: SessionMenuProps) {
  const { t } = useTranslation()

  const sessionId = item.id
  const isArchived = item.isArchived ?? false
  const sharedUrl = item.sharedUrl

  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()

  return (
    <>
      {sharedUrl && (
        <>
          <Sub>
            <SubTrigger>
              <CloudUpload className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sessionMenu.shared")}</span>
            </SubTrigger>
            <SubContent>
              <ShareMenuItems sessionId={sessionId} sharedUrl={sharedUrl} menu={{ MenuItem, Separator }} />
            </SubContent>
          </Sub>
          <Separator />
        </>
      )}
      <MenuItem onClick={onRename}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">{t("common.rename")}</span>
      </MenuItem>

      {!isArchived ? (
        <MenuItem onClick={onArchive}>
          <Archive className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.archive")}</span>
        </MenuItem>
      ) : (
        <MenuItem onClick={onUnarchive}>
          <ArchiveRestore className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.unarchive")}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t("common.delete")}</span>
      </MenuItem>
    </>
  )
}
