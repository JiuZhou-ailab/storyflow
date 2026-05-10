// input: User-entered workspace name, location choice, and workspace creation method
// output: New workspace creation request with explicit Method Pack intent when needed
// pos: Renderer step for creating a local workspace from a built-in creation method

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { Button } from "../ui/button"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { AddWorkspace_RadioOption } from "./AddWorkspace_RadioOption"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"
import {
  buildWorkspaceCreationOptions,
  WORKSPACE_CREATION_METHOD_OPTIONS,
  type WorkspaceCreationMethodId,
} from "./workspace-method-options"
import type { MethodPackId } from "@craft-agent/shared/writing/method-packs"
import type { WorkspaceProjectType } from "../../../shared/types"

type LocationOption = 'default' | 'custom'

interface AddWorkspaceStep_CreateNewProps {
  onBack: () => void
  onCreate: (
    folderPath: string,
    name: string,
    remoteServer: undefined,
    projectType: WorkspaceProjectType,
    methodPackId?: MethodPackId,
  ) => Promise<void>
  isCreating: boolean
}

/**
 * AddWorkspaceStep_CreateNew - Create a new workspace
 *
 * Fields:
 * - Workspace name (required)
 * - Location: Default (~/.craft-agent/workspaces/) or Custom
 */
export function AddWorkspaceStep_CreateNew({
  onBack,
  onCreate,
  isCreating
}: AddWorkspaceStep_CreateNewProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [selectedMethodId, setSelectedMethodId] = useState<WorkspaceCreationMethodId>('general')
  const [locationOption, setLocationOption] = useState<LocationOption>('default')
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [homeDir, setHomeDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // Get home directory on mount
  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir)
  }, [])

  const slug = slugify(name)
  const defaultBasePath = homeDir ? `${homeDir}/.craft-agent/workspaces` : null
  const finalPath = locationOption === 'default'
    ? (defaultBasePath && slug ? `${defaultBasePath}/${slug}` : null)
    : customPath && slug
      ? `${customPath}/${slug}`
      : null

  // Validate slug uniqueness when name changes
  useEffect(() => {
    if (!slug) {
      setError(null)
      return
    }

    const validateSlug = async () => {
      setIsValidating(true)
      try {
        const result = await window.electronAPI.checkWorkspaceSlug(slug)
        if (result.exists) {
          setError(`A workspace named "${slug}" already exists`)
        } else {
          setError(null)
        }
      } catch (err) {
        console.error('Failed to validate workspace slug:', err)
      } finally {
        setIsValidating(false)
      }
    }

    // Debounce validation
    const timeout = setTimeout(validateSlug, 300)
    return () => clearTimeout(timeout)
  }, [slug])

  const handleFolderSelected = useCallback((path: string) => {
    setCustomPath(path)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected)

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !finalPath || error) return
    const options = buildWorkspaceCreationOptions(selectedMethodId)
    await onCreate(finalPath, name.trim(), undefined, options.projectType, options.methodPackId)
  }, [name, finalPath, error, onCreate, selectedMethodId])

  const canCreate = name.trim() && finalPath && !error && !isValidating && !isCreating

  return (
    <AddWorkspaceContainer>
      {/* Back button */}
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

      <div className="mt-6 w-full space-y-6">
        {/* Workspace name */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            {t("workspace.nameLabel")}
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("workspace.myWorkspace")}
              disabled={isCreating}
              autoFocus
              className="border-0 bg-transparent shadow-none"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        {/* Workspace type selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            {t("workspace.methodPackLabel")}
          </label>

          {WORKSPACE_CREATION_METHOD_OPTIONS.map((option) => (
            <AddWorkspace_RadioOption
              key={option.id}
              name="workspace-method"
              checked={selectedMethodId === option.id}
              onChange={() => setSelectedMethodId(option.id)}
              disabled={isCreating}
              title={t(option.titleKey, { defaultValue: option.fallbackTitle })}
              subtitle={t(option.subtitleKey, { defaultValue: option.fallbackSubtitle })}
            />
          ))}
        </div>

        {/* Location selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            {t("workspace.locationLabel")}
          </label>

          {/* Default location option */}
          <AddWorkspace_RadioOption
            name="location"
            checked={locationOption === 'default'}
            onChange={() => setLocationOption('default')}
            disabled={isCreating}
            title={t("workspace.defaultLocation")}
            subtitle={t("workspace.underDefaultFolder")}
          />

          {/* Custom location option */}
          <AddWorkspace_RadioOption
            name="location"
            checked={locationOption === 'custom'}
            onChange={() => setLocationOption('custom')}
            disabled={isCreating}
            title={t("workspace.chooseLocation")}
            subtitle={customPath || t("workspace.pickLocation")}
            action={locationOption === 'custom' ? (
              <AddWorkspaceSecondaryButton
                onClick={(e) => {
                  e.preventDefault()
                  pickDirectory()
                }}
                disabled={isCreating}
              >
                {t("common.browse")}
              </AddWorkspaceSecondaryButton>
            ) : undefined}
          />
        </div>

        {/* Create button */}
        <AddWorkspacePrimaryButton
          onClick={handleCreate}
          disabled={!canCreate}
          loading={isCreating}
          loadingText={t("workspace.creating")}
        >
          {t("common.create")}
        </AddWorkspacePrimaryButton>
      </div>
      <ServerDirectoryBrowser
        open={showServerBrowser}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
      />
    </AddWorkspaceContainer>
  )
}
