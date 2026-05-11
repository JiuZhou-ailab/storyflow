// input: User-entered workspace name, location choice, and workspace creation method
// output: New workspace creation request with explicit Method Pack intent when needed
// pos: Renderer step for creating a local workspace from a built-in creation method

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, CheckCircle2, FolderTree, GitBranch, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { AddWorkspace_RadioOption } from "./AddWorkspace_RadioOption"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"
import {
  buildWorkspaceCreationOptions,
  getWorkspaceCreationMethodOption,
  WORKSPACE_CREATION_METHOD_OPTIONS,
  type WorkspaceCreationMethodId,
  type WorkspaceCreationMethodOption,
  type WorkspaceCreationMethodPreview,
} from "./workspace-method-options"
import type { MethodPackId } from "@craft-agent/shared/writing/method-packs"
import type { WorkspaceProjectType } from "../../../shared/types"

type LocationOption = 'default' | 'custom'

function getLocalizedMethodPreview(
  option: WorkspaceCreationMethodOption,
  language: string | undefined,
): WorkspaceCreationMethodPreview {
  return language?.startsWith('zh') ? option.richPreviewZh : option.richPreview
}

const previewAccentClasses: Record<WorkspaceCreationMethodPreview['accent'], {
  panel: string
  line: string
  node: string
  badge: string
}> = {
  neutral: {
    panel: 'from-foreground/[0.025] to-background',
    line: 'bg-foreground/20',
    node: 'border-foreground/15 bg-background',
    badge: 'bg-foreground/[0.06] text-foreground/70',
  },
  canon: {
    panel: 'from-violet-500/[0.08] to-background',
    line: 'bg-violet-500/35',
    node: 'border-violet-500/25 bg-violet-500/[0.04]',
    badge: 'bg-violet-500/[0.10] text-violet-700 dark:text-violet-300',
  },
  market: {
    panel: 'from-emerald-500/[0.08] to-background',
    line: 'bg-emerald-500/35',
    node: 'border-emerald-500/25 bg-emerald-500/[0.04]',
    badge: 'bg-emerald-500/[0.10] text-emerald-700 dark:text-emerald-300',
  },
  structure: {
    panel: 'from-amber-500/[0.10] to-background',
    line: 'bg-amber-500/40',
    node: 'border-amber-500/30 bg-amber-500/[0.05]',
    badge: 'bg-amber-500/[0.12] text-amber-800 dark:text-amber-300',
  },
  craft: {
    panel: 'from-sky-500/[0.08] to-background',
    line: 'bg-sky-500/35',
    node: 'border-sky-500/25 bg-sky-500/[0.04]',
    badge: 'bg-sky-500/[0.10] text-sky-700 dark:text-sky-300',
  },
}

function MethodPackPreviewPanel({
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
    workflow: string
    assets: string
    bestFor: string
  }
}) {
  const accent = previewAccentClasses[preview.accent]

  return (
    <aside
      className={cn(
        "flex min-h-[28rem] flex-col border-t border-foreground/10 pt-5",
        "lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
      )}
      aria-live="polite"
    >
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {labels.logic}
        </div>
        <h2 className="mt-1 text-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {preview.thesis}
        </p>
      </div>

      <div className={cn(
        "mt-4 flex min-h-[18rem] flex-1 flex-col overflow-hidden rounded-lg border border-foreground/10 bg-linear-to-br p-4 shadow-minimal",
        accent.panel
      )}>
        <div className="flex items-center gap-2 text-xs font-medium text-foreground/75">
          <GitBranch className="h-3.5 w-3.5" />
          {labels.workflow}
        </div>

        <div className="mt-4 grid flex-1 content-center gap-3">
          {preview.stages.map((stage, index) => (
            <div key={stage.label} className="relative flex items-start gap-3">
              {index < preview.stages.length - 1 ? (
                <div className={cn("absolute left-[0.95rem] top-8 h-[calc(100%+0.25rem)] w-px", accent.line)} />
              ) : null}
              <div className={cn(
                "relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                accent.node
              )}>
                {index + 1}
              </div>
              <div className={cn("min-w-0 rounded-md border px-3 py-2", accent.node)}>
                <div className="text-sm font-semibold leading-5 text-foreground">
                  {stage.label}
                </div>
                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {stage.detail}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-foreground/10 pt-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground/75">
            <FolderTree className="h-3.5 w-3.5" />
            {labels.assets}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {preview.assets.map((asset) => (
              <span key={asset} className={cn("rounded-[5px] px-2 py-1 text-[11px] font-medium", accent.badge)}>
                {asset}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <Target className="mt-1 h-4 w-4 shrink-0 text-foreground/50" />
          <span>{preview.bestFor}</span>
        </div>
        <div className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-foreground/50" />
          <span>{description}</span>
        </div>
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
  const { t, i18n } = useTranslation()
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
  const selectedMethodOption = getWorkspaceCreationMethodOption(selectedMethodId)
  const selectedMethodTitle = t(selectedMethodOption.titleKey, { defaultValue: selectedMethodOption.fallbackTitle })
  const selectedMethodPreviewDescription = t(selectedMethodOption.previewDescriptionKey, { defaultValue: selectedMethodOption.fallbackPreviewDescription })
  const selectedMethodPreview = getLocalizedMethodPreview(selectedMethodOption, i18n.language)

  return (
    <AddWorkspaceContainer className="max-h-[calc(100vh-7rem)] max-w-[64rem] items-stretch overflow-y-auto">
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

      <div className="mt-6 grid w-full gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
        <div className="space-y-6">
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

        <MethodPackPreviewPanel
          title={selectedMethodTitle}
          description={selectedMethodPreviewDescription}
          preview={selectedMethodPreview}
          labels={{
            logic: t("workspace.methodPreviewLabel", { defaultValue: "Method logic" }),
            workflow: t("workspace.methodPreviewWorkflow", { defaultValue: "Workflow map" }),
            assets: t("workspace.methodPreviewAssets", { defaultValue: "Workspace assets" }),
            bestFor: t("workspace.methodPreviewBestFor", { defaultValue: "Best for" }),
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
