// input: Workspace creation callbacks, selected writing method, and local directory APIs
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
import {
  DEFAULT_WORKSPACE_CREATION_METHOD_ID,
  buildWorkspaceFolderPath,
  buildWorkspaceCreationOptions,
  getWorkspaceCreationMethodOption,
  WORKSPACE_CREATION_METHOD_OPTIONS,
  type WorkspaceCreationLocationOption,
  type WorkspaceCreationMethodId,
  type WorkspaceCreationMethodOption,
  type WorkspaceCreationMethodPreview,
} from "./workspace-method-options"
import type { MethodPackId } from "@craft-agent/shared/writing/method-packs"
import type { WorkspaceProjectType } from "../../../shared/types"

function getLocalizedMethodPreview(
  option: WorkspaceCreationMethodOption,
  _language: string | undefined,
): WorkspaceCreationMethodPreview {
  return option.richPreview
}

export function MethodPackPreviewPanel({
  title,
  description,
  preview,
  labels,
}: {
  title: string
  description: string
  preview: WorkspaceCreationMethodPreview
  labels: {
    logic: string
    stages: string
    assets: string
    bestFor: string
  }
}) {
  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col text-sm",
        // One separator only: top on mobile, left on desktop. No inner card border.
        "border-t border-foreground/[0.08] pt-5",
        "lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0 lg:pr-1",
      )}
      aria-live="polite"
    >
      <div className="space-y-5 pb-1">
        <div>
          <div className="text-[11px] font-medium text-muted-foreground">
            {labels.logic}
          </div>
          <h2 className="mt-2 text-[15px] font-semibold tracking-[-0.015em] text-foreground">
            {title}
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{preview.thesis}</p>
          {description && description !== preview.thesis ? (
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground/75">{description}</p>
          ) : null}
        </div>

        <section>
          <div className="text-[11px] font-medium text-foreground/65">{labels.stages}</div>
          <ol className="mt-2.5 space-y-0">
            {preview.stages.map((stage, index) => (
              <li
                key={stage.label}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 py-1.5"
              >
                <span className="pt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-foreground">
                    {stage.label}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                    {stage.detail}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <div className="text-[11px] font-medium text-foreground/65">{labels.assets}</div>
          <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1">
            {preview.assets.map((asset) => (
              <span
                key={asset}
                className="font-mono text-[11px] leading-5 text-muted-foreground"
              >
                {asset}
              </span>
            ))}
          </div>
        </section>

        <section>
          <div className="text-[11px] font-medium text-foreground/65">{labels.bestFor}</div>
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{preview.bestFor}</p>
        </section>
      </div>
    </aside>
  )
}

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
  const { t, i18n } = useTranslation()
  const [name, setName] = useState('')
  const [selectedMethodId, setSelectedMethodId] = useState<WorkspaceCreationMethodId>(DEFAULT_WORKSPACE_CREATION_METHOD_ID)
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
    const options = buildWorkspaceCreationOptions(selectedMethodId)
    await onCreate(finalPath, name.trim(), undefined, options.projectType, options.methodPackId)
  }, [name, finalPath, error, onCreate, selectedMethodId])

  const canCreate = name.trim() && finalPath && !error && !isValidating && !isCreating
  const selectedMethodOption = getWorkspaceCreationMethodOption(selectedMethodId)
  const selectedMethodTitle = selectedMethodOption.fallbackTitle
  const selectedMethodPreviewDescription = selectedMethodOption.fallbackPreviewDescription
  const selectedMethodPreview = getLocalizedMethodPreview(selectedMethodOption, i18n.language)

  return (
    <AddWorkspaceContainer
      embedded={embedded}
      className={cn(
        embedded
          ? 'h-full min-h-0 max-h-none max-w-[88rem] items-stretch overflow-y-auto lg:overflow-hidden'
          : 'max-h-[calc(100vh-7rem)] max-w-[88rem] items-stretch overflow-y-auto',
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

      <div className={cn(
        "grid w-full gap-6 lg:grid-cols-[minmax(17rem,0.9fr)_minmax(0,1.2fr)] lg:gap-0",
        embedded ? "mt-0 min-h-0 lg:h-full" : "mt-6",
      )}>
        <div className={cn("space-y-5", embedded && "flex min-h-0 flex-col space-y-0")}>
          <div className={cn(
            embedded && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-8",
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

            {/* Workspace type selection */}
            <div className={cn(embedded ? "mt-5" : "", "space-y-2")}>
              <label className="mb-2 block text-[13px] font-medium text-foreground">
                {t("workspace.methodPackLabel")}
              </label>
              {embedded ? (
                <AddWorkspace_RadioGroup aria-label={t("workspace.methodPackLabel")}>
                  {WORKSPACE_CREATION_METHOD_OPTIONS.map((option) => (
                    <AddWorkspace_RadioOption
                      key={option.id}
                      name="workspace-method"
                      checked={selectedMethodId === option.id}
                      onChange={() => setSelectedMethodId(option.id)}
                      disabled={isCreating}
                      title={option.fallbackTitle}
                      compact
                    />
                  ))}
                </AddWorkspace_RadioGroup>
              ) : (
                <div className="space-y-2" role="radiogroup" aria-label={t("workspace.methodPackLabel")}>
                  {WORKSPACE_CREATION_METHOD_OPTIONS.map((option) => (
                    <AddWorkspace_RadioOption
                      key={option.id}
                      name="workspace-method"
                      checked={selectedMethodId === option.id}
                      onChange={() => setSelectedMethodId(option.id)}
                      disabled={isCreating}
                      title={option.fallbackTitle}
                      subtitle={option.fallbackSubtitle}
                    />
                  ))}
                </div>
              )}
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

        <MethodPackPreviewPanel
          title={selectedMethodTitle}
          description={selectedMethodPreviewDescription}
          preview={selectedMethodPreview}
          labels={{
            logic: "方法逻辑",
            stages: "写作路径",
            assets: "工作区资产",
            bestFor: "适合项目",
          }}
        />
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
