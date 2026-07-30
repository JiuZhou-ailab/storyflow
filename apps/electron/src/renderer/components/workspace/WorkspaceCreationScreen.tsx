// input: Local project creation and existing remote-project reconnect callbacks
// output: Full-screen local creation or remote recovery flow
// pos: Renderer orchestrator that keeps project creation local and reconnect separate

import { useState, useEffect, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ChevronLeft, X } from "lucide-react"
import { motion } from "motion/react"
import { Dithering } from "@paper-design/shaders-react"
import { FullscreenOverlayBase } from "@craft-agent/ui"
import { cn } from "@/lib/utils"
import { overlayTransitionIn } from "@/lib/animations"
import { AddWorkspaceStep_CreateNew } from "./AddWorkspaceStep_CreateNew"
import { AddWorkspaceStep_ConnectRemote } from "./AddWorkspaceStep_ConnectRemote"
import type { Workspace } from "../../../shared/types"
import { toast } from "sonner"

interface WorkspaceCreationScreenProps {
  /** Callback when a workspace is created successfully */
  onWorkspaceCreated: (workspace: Workspace) => void | Promise<void>
  /** Callback when the screen is dismissed */
  onClose: () => void
  className?: string
  /** When set, show remote recovery instead of local project creation. */
  reconnectWorkspace?: Workspace
  /** Reconnect an existing remote workspace and resolve only on real success. */
  onReconnectWorkspace?: (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => Promise<void>
  /** Whether the user may dismiss the flow without creating/reconnecting a workspace. */
  canClose?: boolean
  /** Optional visible label for the dismiss action, used when returning to project management. */
  closeLabel?: string
}

interface WorkspaceCreationApi {
  createWorkspace(folderPath: string, name: string): Promise<Workspace>
}

export async function createWorkspaceAndNotify(
  api: WorkspaceCreationApi,
  folderPath: string,
  name: string,
  onWorkspaceCreated: (workspace: Workspace) => void | Promise<void>,
): Promise<void> {
  const workspace = await api.createWorkspace(folderPath, name)
  await onWorkspaceCreated(workspace)
}

/**
 * WorkspaceCreationScreen - Full-screen local creation or remote reconnect overlay.
 */
export function WorkspaceCreationScreen({
  onWorkspaceCreated,
  onClose,
  className,
  reconnectWorkspace,
  onReconnectWorkspace,
  canClose = true,
  closeLabel,
}: WorkspaceCreationScreenProps) {
  const { t } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 })

  // Track window dimensions for shader
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight })
    }
    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // Wrap onClose to prevent closing during creation
  // FullscreenOverlayBase handles ESC key, this wrapper prevents closing when busy
  const handleClose = useCallback(() => {
    if (canClose && !isCreating) {
      onClose()
    }
  }, [canClose, isCreating, onClose])

  const handleCreateWorkspace = useCallback(async (
    folderPath: string,
    name: string,
  ) => {
    setIsCreating(true)
    try {
      await createWorkspaceAndNotify(
        window.electronAPI,
        folderPath,
        name,
        onWorkspaceCreated,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(t('toast.failedToCreateWorkspace'), {
        description: message,
      })
    } finally {
      setIsCreating(false)
    }
  }, [onWorkspaceCreated, t])

  const handleReconnectWorkspace = useCallback(async (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => {
    if (!onReconnectWorkspace) {
      throw new Error('Reconnect handler not configured')
    }

    setIsCreating(true)
    try {
      await onReconnectWorkspace(workspaceId, remoteServer)
    } finally {
      setIsCreating(false)
    }
  }, [onReconnectWorkspace])

  const content = reconnectWorkspace?.remoteServer ? (
    <AddWorkspaceStep_ConnectRemote
      onBack={handleClose}
      isCreating={isCreating}
      initialUrl={reconnectWorkspace.remoteServer.url}
      reconnectWorkspace={{
        id: reconnectWorkspace.id,
        name: reconnectWorkspace.name,
        remoteWorkspaceId: reconnectWorkspace.remoteServer.remoteWorkspaceId,
      }}
      onUpdate={handleReconnectWorkspace}
    />
  ) : (
    <AddWorkspaceStep_CreateNew
      onBack={handleClose}
      onCreate={handleCreateWorkspace}
      isCreating={isCreating}
    />
  )

  // Get theme colors from CSS variables for the shader
  const shaderColors = useMemo(() => {
    if (typeof window === 'undefined') return { back: '#00000000', front: '#684e85' }
    const root = document.documentElement
    const isDark = root.classList.contains('dark')
    // Transparent back, accent-tinted front
    return isDark
      ? { back: '#00000000', front: '#9b7bb8' }  // lighter accent for dark mode
      : { back: '#00000000', front: '#684e85' }  // accent color
  }, [])

  // FullscreenOverlayBase handles portal, traffic lights, and ESC key
  return (
    <FullscreenOverlayBase
      isOpen={true}
      onClose={handleClose}
      className={cn("z-splash flex flex-col bg-background", className)}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={overlayTransitionIn}
        className="flex flex-col flex-1"
      >
        {/* Dithering shader background */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.3 }}
          transition={overlayTransitionIn}
          className="absolute inset-0 pointer-events-none"
        >
          <Dithering
            colorBack={shaderColors.back}
            colorFront={shaderColors.front}
            shape="swirl"
            type="8x8"
            size={2}
            speed={1}
            scale={1}
            width={dimensions.width}
            height={dimensions.height}
          />
        </motion.div>

        {/* Header with drag region and close controls */}
        <header className="titlebar-drag-region relative flex h-[50px] shrink-0 items-center justify-between px-6">
          {/* macOS: keep the native traffic-light cluster (top-left) clickable */}
          <div className="titlebar-no-drag absolute left-0 top-0 h-full w-[80px]" />
          {canClose && closeLabel && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={overlayTransitionIn}
              onClick={(e) => {
                e.stopPropagation()
                handleClose()
              }}
              disabled={isCreating}
              className={cn(
                "titlebar-no-drag ml-[74px] mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 text-[13px] font-medium shadow-minimal",
                "text-muted-foreground hover:bg-foreground-5 hover:text-foreground",
                "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isCreating && "cursor-not-allowed opacity-50"
              )}
              aria-label={closeLabel}
            >
              <ChevronLeft className="size-4" />
              {closeLabel}
            </motion.button>
          )}
          <div className="flex-1" />
          {/* Close button - explicitly no-drag */}
          {canClose && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={overlayTransitionIn}
              onClick={(e) => {
                e.stopPropagation()
                handleClose()
              }}
              disabled={isCreating}
              className={cn(
                "titlebar-no-drag flex items-center justify-center p-2 rounded-[6px]",
                "bg-background shadow-minimal hover:bg-foreground-5",
                "text-muted-foreground hover:text-foreground",
                "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "mr-[-8px] mt-2",
                isCreating && "opacity-50 cursor-not-allowed"
              )}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </motion.button>
          )}
        </header>

        {/* Main content */}
        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={overlayTransitionIn}
          className="relative flex flex-1 items-center justify-center p-8"
        >
          {content}
        </motion.main>
      </motion.div>
    </FullscreenOverlayBase>
  )
}
