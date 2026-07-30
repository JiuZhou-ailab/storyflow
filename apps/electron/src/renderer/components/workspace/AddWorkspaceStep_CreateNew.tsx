// input: Workspace creation callbacks and the local directory picker
// output: One folder-first local project form with an optional display name
// pos: Canonical local project creation form shared by dialog and fullscreen surfaces

import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { getPathBasename } from "@/lib/platform"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"

export function resolveWorkspaceName(folderPath: string, name: string): string {
  return name.trim() || getPathBasename(folderPath)
}

interface AddWorkspaceStep_CreateNewProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string) => Promise<void>
  isCreating: boolean
  /** Optional container class (e.g. embed into project dialog without card chrome). */
  className?: string
  /** Parent surface already renders the step title and the return action. */
  embedded?: boolean
}

/**
 * AddWorkspaceStep_CreateNew - Use one local folder as a workspace.
 */
export function AddWorkspaceStep_CreateNew({
  onBack,
  onCreate,
  isCreating,
  className,
  embedded = false,
}: AddWorkspaceStep_CreateNewProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const handleFolderSelected = useCallback((path: string) => {
    setSelectedPath(path)
  }, [])

  const { pickDirectory } = useDirectoryPicker(handleFolderSelected, 'local-machine')
  const folderName = selectedPath ? getPathBasename(selectedPath) : ''

  const handleCreate = useCallback(async () => {
    if (!selectedPath) return
    const workspaceName = resolveWorkspaceName(selectedPath, name)
    if (!workspaceName) return
    await onCreate(selectedPath, workspaceName)
  }, [name, onCreate, selectedPath])

  const canCreate = Boolean(selectedPath && resolveWorkspaceName(selectedPath, name) && !isCreating)

  return (
    <AddWorkspaceContainer
      embedded={embedded}
      className={cn(
        embedded
          ? 'h-full min-h-0 max-h-none max-w-[32rem] items-stretch overflow-y-auto'
          : 'max-h-[calc(100vh-7rem)] items-stretch overflow-y-auto',
        className,
      )}
    >
      {!embedded ? (
        <>
          <button
            onClick={onBack}
            disabled={isCreating}
            className={cn(
              "self-start flex items-center gap-1 text-sm text-muted-foreground",
              "hover:text-foreground transition-colors mb-4",
              isCreating && "opacity-50 cursor-not-allowed"
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </button>

          <AddWorkspaceStepHeader
            title={t("workspace.createWorkspace")}
            description={t("workspace.createWorkspaceDesc")}
          />
        </>
      ) : null}

      <div className={cn("mx-auto w-full max-w-[32rem] space-y-5", embedded ? "mt-0" : "mt-6")}>
        <div className="space-y-2">
          <label className="block text-[13px] font-medium text-foreground">
            {t("workspace.locationLabel")}
          </label>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-background p-4">
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                selectedPath ? "text-foreground" : "text-muted-foreground",
              )}
              title={selectedPath ?? undefined}
            >
              {selectedPath || t("workspace.noFolderSelected")}
            </p>
            <AddWorkspaceSecondaryButton onClick={pickDirectory} disabled={isCreating}>
              {t("common.browse")}
            </AddWorkspaceSecondaryButton>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-[13px] font-medium text-foreground">
            {t("workspace.nameLabel")}
            <span className="ml-1 font-normal text-muted-foreground">
              ({t("common.optional")})
            </span>
          </label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={folderName || t("workspace.myWorkspace")}
            disabled={isCreating}
            className={cn(
              "h-10 bg-foreground/[0.025] shadow-none",
              embedded && "border-foreground/[0.10] focus-visible:ring-foreground/20",
            )}
          />
        </div>

        <AddWorkspacePrimaryButton
          onClick={handleCreate}
          disabled={!canCreate}
          loading={isCreating}
          loadingText={t("workspace.creating")}
        >
          {t("common.create")}
        </AddWorkspacePrimaryButton>
      </div>
    </AddWorkspaceContainer>
  )
}
