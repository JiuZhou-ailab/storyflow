// input: Source session ids, Free/Project targets, and transfer RPCs
// output: Explicit one-time summary snapshots imported as fresh target sessions
// pos: UI boundary for cross-domain transfer; source and target histories never link

import * as React from 'react'
import { useTranslation } from "react-i18next"
import { useState, useCallback, useEffect, useRef } from 'react'
import { Cloud, CloudOff, Folder, MessageSquare, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { useWorkspaceIcons } from '@/hooks/useWorkspaceIcon'
import { cn } from '@/lib/utils'
import type { Workspace } from '../../../shared/types'
import { FREE_CONVERSATION_WORKSPACE_ID } from '../../../shared/types'

interface TransferTarget {
  id: string
  name: string
  workspace?: Workspace
}

export interface SendToWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Session IDs to transfer */
  sessionIds: string[]
  /** All workspaces */
  workspaces: Workspace[]
  /** Current workspace ID (excluded from picker) */
  activeWorkspaceId: string | null
  /** Called after successful transfer with target workspace ID and new session IDs */
  onTransferComplete?: (targetWorkspaceId: string, newSessionIds: string[]) => void
}

export function SendToWorkspaceDialog({
  open,
  onOpenChange,
  sessionIds,
  workspaces,
  activeWorkspaceId,
  onTransferComplete,
}: SendToWorkspaceDialogProps) {
  const { t } = useTranslation()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)
  const workspaceIconMap = useWorkspaceIcons(workspaces)

  // Health check results for remote targets (checked on dialog open)
  const [remoteHealthMap, setRemoteHealthMap] = useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = useRef<AbortController | null>(null)

  const targets = React.useMemo<TransferTarget[]>(() => {
    const projectTargets = workspaces
      .filter(workspace => workspace.id !== activeWorkspaceId)
      .map(workspace => ({ id: workspace.id, name: workspace.name, workspace }))
    if (activeWorkspaceId === FREE_CONVERSATION_WORKSPACE_ID) return projectTargets
    return [
      {
        id: FREE_CONVERSATION_WORKSPACE_ID,
        name: '自由对话',
      },
      ...projectTargets,
    ]
  }, [activeWorkspaceId, t, workspaces])
  const remoteTargets = targets.filter(target => target.workspace?.remoteServer)

  // Check connectivity for all remote workspaces when dialog opens
  useEffect(() => {
    if (!open) {
      healthCheckAbort.current?.abort()
      return
    }

    // Cancel any in-flight checks
    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    if (remoteTargets.length === 0) return

    // Mark all as checking
    setRemoteHealthMap(() => {
      const next = new Map<string, 'ok' | 'error' | 'checking'>()
      for (const target of remoteTargets) next.set(target.id, 'checking')
      return next
    })

    // Fire parallel checks
    for (const target of remoteTargets) {
      const remoteServer = target.workspace!.remoteServer!
      window.electronAPI.testRemoteConnection(remoteServer.url, remoteServer.credentialRef)
        .then(result => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(target.id, result.ok ? 'ok' : 'error'))
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(target.id, 'error'))
        })
    }

    return () => abort.abort()
  }, [open, remoteTargets.map(target => target.id).join(',')])

  const handleTransfer = useCallback(async () => {
    if (!selectedWorkspaceId || sessionIds.length === 0) return

    const target = targets.find(candidate => candidate.id === selectedWorkspaceId)
    if (!target) return

    setIsTransferring(true)
    const targetName = target.name
    const count = sessionIds.length

    const toastId = toast.loading(t('sendToWorkspace.sending', { count, target: targetName }))

    try {
      const newSessionIds: string[] = []

      for (const sessionId of sessionIds) {
        const result = await window.electronAPI.transferSessionToWorkspace(
          sessionId,
          selectedWorkspaceId,
        )
        newSessionIds.push(result.sessionId)
      }

      toast.success(t('sendToWorkspace.sent', { count, target: targetName }), {
        id: toastId,
        action: onTransferComplete ? {
          label: t('sendToWorkspace.open'),
          onClick: () => onTransferComplete(selectedWorkspaceId, newSessionIds),
        } : undefined,
      })

      onOpenChange(false)
      setSelectedWorkspaceId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(t('sendToWorkspace.failedToSend', { count }), {
        id: toastId,
        description: message,
      })
    } finally {
      setIsTransferring(false)
    }
  }, [selectedWorkspaceId, sessionIds, targets, onOpenChange, onTransferComplete])

  const count = sessionIds.length

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isTransferring) {
        onOpenChange(isOpen)
        if (!isOpen) setSelectedWorkspaceId(null)
      }
    }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            {t("sendToWorkspace.title")}
          </DialogTitle>
          <DialogDescription>
            {t("sendToWorkspace.description", { count })}
          </DialogDescription>
        </DialogHeader>

        {/* Every target receives a fresh summary-seeded session. */}
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto py-1">
          {targets.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2 py-4 text-center">
              {t("sendToWorkspace.noRemoteWorkspaces")}
            </p>
          ) : (
            targets.map(target => {
              const isSelected = selectedWorkspaceId === target.id
              const healthStatus = remoteHealthMap.get(target.id)
              const isDisconnected = healthStatus === 'error'
              const isChecking = healthStatus === 'checking'
              const isFreeTarget = target.id === FREE_CONVERSATION_WORKSPACE_ID

              return (
                <button
                  key={target.id}
                  type="button"
                  disabled={isTransferring || isDisconnected}
                  onClick={() => setSelectedWorkspaceId(target.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-2 rounded-md text-left text-sm transition-colors',
                    'hover:bg-foreground/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-foreground/10 ring-1 ring-foreground/15',
                    isDisconnected && 'opacity-50 cursor-not-allowed hover:bg-transparent',
                  )}
                >
                  {target.workspace ? (
                    <CrossfadeAvatar
                      src={workspaceIconMap.get(target.id)}
                      alt={target.name}
                      className="h-5 w-5 rounded-full ring-1 ring-border/50 shrink-0"
                      fallbackClassName="bg-muted text-[10px] rounded-full"
                      fallback={target.name?.charAt(0) || 'W'}
                    />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
                      {isFreeTarget
                        ? <MessageSquare className="h-3 w-3" />
                        : <Folder className="h-3 w-3" />}
                    </span>
                  )}
                  <span className="flex-1 truncate">{target.name}</span>
                  {isDisconnected ? (
                    <CloudOff className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  ) : target.workspace?.remoteServer ? (
                    <Cloud className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isChecking ? 'text-muted-foreground/30 animate-pulse' : 'text-muted-foreground',
                    )} />
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isTransferring}
          >
            Cancel
          </Button>
          <Button onClick={handleTransfer} disabled={!selectedWorkspaceId || isTransferring}>
            {isTransferring ? 'Sending...' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
