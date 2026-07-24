// input: Workspace creation callbacks, project name, and local directory APIs
// output: Form content for creating a workspace, optionally embedded below parent navigation
// pos: Reusable creation form; standalone screen and project manager share this implementation

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { shortenDisplayPath } from "@/lib/display-format"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { AddWorkspace_RadioGroup, AddWorkspace_RadioOption } from "./AddWorkspace_RadioOption"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"

type WorkspaceCreationLocationOption = "default" | "custom"

function appendPathSegment(basePath: string, segment: string): string {
  const separator = basePath.includes("\\") ? "\\" : "/"
  const normalizedBase = basePath.replace(/[\\/]+$/g, "")
  const normalizedSegment = segment.replace(/^[\\/]+/g, "")
  return `${normalizedBase}${separator}${normalizedSegment}`
}

export function buildWorkspaceFolderPath(input: {
  homeDir: string
  name: string
  customPath: string | null
  locationOption: WorkspaceCreationLocationOption
}): string | null {
  const slug = slugify(input.name)
  if (!slug) return null

  const basePath = input.locationOption === "default"
    ? (input.homeDir ? appendPathSegment(appendPathSegment(input.homeDir, ".craft-agent"), "workspaces") : null)
    : input.customPath

  return basePath ? appendPathSegment(basePath, slug) : null
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
 * AddWorkspaceStep_CreateNew - Create a new workspace
 *
 * Fields:
 * - Workspace name (required)
 * - Location: Default (~/.craft-agent/workspaces/) or Custom
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
  const [locationOption, setLocationOption] = useState<WorkspaceCreationLocationOption>('default')
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [homeDir, setHomeDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // Get home directory on mount
  useEffect(() => {
    const electronAPI = window.electronAPI
    if (!electronAPI?.getHomeDir) return
    void electronAPI.getHomeDir().then(setHomeDir)
  }, [])

  const slug = slugify(name)
  const finalPath = buildWorkspaceFolderPath({
    homeDir,
    name,
    customPath,
    locationOption,
  })

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
    await onCreate(finalPath, name.trim())
  }, [name, finalPath, error, onCreate])

  const canCreate = name.trim() && finalPath && !error && !isValidating && !isCreating

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

      <div className={cn("mx-auto w-full max-w-[32rem]", embedded ? "mt-0 min-h-0" : "mt-6")}>
        <div className={cn("space-y-5", embedded && "flex min-h-0 flex-col space-y-0")}>
          <div className={cn(
            embedded && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto",
            !embedded && "space-y-5",
          )}>
            {/* Workspace name */}
            <div className="space-y-2">
              <label className="mb-2 block text-[13px] font-medium text-foreground">
                {t("workspace.nameLabel")}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("workspace.myWorkspace")}
                disabled={isCreating}
                autoFocus
                className={cn(
                  "h-10 bg-foreground/[0.025] shadow-none",
                  embedded && "border-foreground/[0.10] focus-visible:ring-foreground/20",
                )}
              />
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : finalPath ? (
                <p
                  className="truncate font-mono text-[11px] leading-4 text-muted-foreground/80"
                  title={finalPath}
                >
                  {shortenDisplayPath(finalPath, 3)}
                </p>
              ) : null}
            </div>

            {/* Location selection */}
            <div className={cn(embedded ? "mt-5 pb-1" : "", "space-y-2")}>
              <label className="mb-2 block text-[13px] font-medium text-foreground">
                {t("workspace.locationLabel")}
              </label>
              {embedded ? (
                <AddWorkspace_RadioGroup aria-label={t("workspace.locationLabel")}>
                  <AddWorkspace_RadioOption
                    name="location"
                    checked={locationOption === 'default'}
                    onChange={() => setLocationOption('default')}
                    disabled={isCreating}
                    title={t("workspace.defaultLocation")}
                    subtitle={t("workspace.underDefaultFolder")}
                    compact
                  />
                  <AddWorkspace_RadioOption
                    name="location"
                    checked={locationOption === 'custom'}
                    onChange={() => setLocationOption('custom')}
                    disabled={isCreating}
                    title={t("workspace.chooseLocation")}
                    subtitle={customPath || t("workspace.pickLocation")}
                    compact
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
                </AddWorkspace_RadioGroup>
              ) : (
                <div className="space-y-2" role="radiogroup" aria-label={t("workspace.locationLabel")}>
                  <AddWorkspace_RadioOption
                    name="location"
                    checked={locationOption === 'default'}
                    onChange={() => setLocationOption('default')}
                    disabled={isCreating}
                    title={t("workspace.defaultLocation")}
                    subtitle={t("workspace.underDefaultFolder")}
                  />
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
              )}
            </div>
          </div>

          {/* Create button */}
          <AddWorkspacePrimaryButton
            onClick={handleCreate}
            disabled={!canCreate}
            loading={isCreating}
            loadingText={t("workspace.creating")}
            className={cn(embedded && "mt-4 shrink-0")}
          >
            {t("common.create")}
          </AddWorkspacePrimaryButton>
        </div>
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
