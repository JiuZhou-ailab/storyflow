// input: Skill ownership, local availability, and action callbacks
// output: Shared local-management menu and scope-aware Skill removal confirmation
// pos: Reusable action surface for Skill list and detail views

/**
 * SkillMenu - Shared menu content for skill actions
 *
 * Used by:
 * - SkillInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent skill actions and the shared removal confirmation:
 * - Open in New Window
 * - Show in file manager
 * - Publish user-owned Skills to Storyflow Skills Market
 * - Remove
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import { toast } from 'sonner'
import { isDefaultGlobalAgentSkillSlug } from '@craft-agent/shared/agent-defaults/skills'
import {
  Trash2,
  FolderOpen,
  AppWindow,
  Send,
  Upload,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getFileManagerName } from '@/lib/platform'
import type { LoadedSkill } from '../../../shared/types'

export interface SkillMenuProps {
  /** Callbacks */
  onOpenInNewWindow: () => void
  onShowInFinder: () => void
  onRemove?: () => void
  canShowInFinder?: boolean
  canRemove?: boolean
  removeLabel?: string
  /** Send to another workspace (omit to hide the option) */
  onSendToWorkspace?: () => void
  /** Publish a locally owned Skill through Storyflow's Market (omit to hide) */
  onPublishToMarket?: () => void
}

interface SkillRemovalDialogProps {
  skill: LoadedSkill | null
  workspaceId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemoved?: (skill: LoadedSkill) => void
}

export function SkillRemovalDialog({
  skill,
  workspaceId,
  open,
  onOpenChange,
  onRemoved,
}: SkillRemovalDialogProps) {
  const { t } = useTranslation()
  const [removing, setRemoving] = React.useState(false)
  const displayName = skill?.metadata.displayName ?? skill?.metadata.name ?? skill?.slug ?? ''
  const descriptionKey = skill?.scope === 'user'
    ? 'skillManagement.removeUserDescription'
    : skill?.scope === 'project'
      ? 'skillManagement.removeProjectDescription'
      : 'skillManagement.removeLocalDescription'
  const skillDirectorySlug = skill?.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) ?? ''
  const canRemove = skill?.origin === 'top-level' && !isDefaultGlobalAgentSkillSlug(skillDirectorySlug)

  const handleRemove = async () => {
    if (!skill || !workspaceId || !canRemove || removing) return
    setRemoving(true)
    try {
      await window.electronAPI.deleteSkill(workspaceId, skill.slug)
      toast.success(t('skillManagement.removed', { name: displayName }))
      onOpenChange(false)
      onRemoved?.(skill)
    } catch (error) {
      toast.error(t('skillManagement.removeFailed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={removing}>
      <DialogContent size="sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('skillManagement.removeTitle', { name: displayName })}</DialogTitle>
          <DialogDescription>{t(descriptionKey)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={removing} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!skill || !workspaceId || !canRemove || removing}
            onClick={() => void handleRemove()}
          >
            {removing ? t('skillManagement.removing') : t('skillManagement.removeAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * SkillMenu - Renders the menu items for skill actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SkillMenu({
  onOpenInNewWindow,
  onShowInFinder,
  onRemove,
  canShowInFinder = true,
  canRemove = true,
  removeLabel,
  onSendToWorkspace,
  onPublishToMarket,
}: SkillMenuProps) {
  const { t } = useTranslation()

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sidebarMenu.openInNewWindow")}</span>
      </MenuItem>

      {/* Show in file manager */}
      <MenuItem onClick={onShowInFinder} disabled={!canShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.showInFileManager", { fileManager: getFileManagerName() })}</span>
      </MenuItem>

      {/* Send to another workspace */}
      {onSendToWorkspace && (
        <MenuItem onClick={onSendToWorkspace}>
          <Send className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.sendToWorkspace")}</span>
        </MenuItem>
      )}

      {onPublishToMarket && (
        <MenuItem onClick={onPublishToMarket}>
          <Upload className="h-3.5 w-3.5" />
          <span className="flex-1">{t('skillsList.publishToMarket')}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Remove */}
      <MenuItem onClick={canRemove ? onRemove : undefined} variant="destructive" disabled={!canRemove}>
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{removeLabel || t('skillManagement.removeAction')}</span>
      </MenuItem>
    </>
  )
}
