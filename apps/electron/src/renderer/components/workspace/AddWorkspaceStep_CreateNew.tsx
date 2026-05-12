// input: User-entered workspace name, location choice, and workspace creation method
// output: New workspace creation request with explicit Method Pack intent when needed
// pos: Renderer step for creating a local workspace from a built-in creation method

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "lucide-react"
import { MarkdownMermaidBlock } from "@craft-agent/ui/markdown"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { AddWorkspace_RadioOption } from "./AddWorkspace_RadioOption"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"
import {
  buildWorkspaceFolderPath,
  buildWorkspaceCreationOptions,
  getWorkspaceCreationMethodOption,
  WORKSPACE_CREATION_METHOD_OPTIONS,
  type WorkspaceCreationLocationOption,
  type WorkspaceCreationMethodId,
  type WorkspaceCreationMethodOption,
  type WorkspaceCreationMethodPreview,
} from "./workspace-method-options"
import type { MethodPackId, MethodPackRequiredPath } from "@craft-agent/shared/writing/method-packs"
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
  mermaidCode,
  fileContract,
  labels,
}: {
  title: string
  description: string
  preview: WorkspaceCreationMethodPreview
  mermaidCode: string
  fileContract: MethodPackRequiredPath[]
  labels: {
    logic: string
    workflow: string
    structure: string
    assets: string
    fileContract: string
    file: string
    directory: string
    bestFor: string
  }
}) {
  return (
    <aside
      className={cn(
        "flex min-h-[28rem] flex-col border-t border-foreground/10 pt-5 text-sm",
        "lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
      )}
      aria-live="polite"
    >
      <div className="space-y-4">
        <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {labels.logic}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-2 leading-6 text-muted-foreground">{preview.thesis}</p>
          <p className="mt-2 leading-6 text-muted-foreground">{description}</p>
        </div>

        <section className="border-t border-foreground/10 pt-4">
          <div className="text-xs font-medium text-foreground/75">{labels.workflow}</div>
          <MarkdownMermaidBlock
            code={mermaidCode}
            className="mt-3"
            showExpandButton={false}
            tapToOpen={false}
            minHeight={160}
          />
          <ol className="mt-3 space-y-3">
            {preview.stages.map((stage, index) => (
              <li key={stage.label} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
                <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <div>
                  <div className="font-medium leading-5 text-foreground">{stage.label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{stage.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-foreground/10 pt-4">
          <div className="text-xs font-medium text-foreground/75">{labels.structure}</div>
          <div className="mt-3 space-y-3">
            {preview.structure.map((group) => (
              <div key={group.label}>
                <div className="font-medium leading-5 text-foreground">{group.label}</div>
                <ul className="mt-1 space-y-1">
                  {group.items.map((item) => (
                    <li key={item} className="text-xs leading-5 text-muted-foreground">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {fileContract.length > 0 ? (
          <section className="border-t border-foreground/10 pt-4">
            <div className="flex items-center justify-between gap-3 text-xs font-medium text-foreground/75">
              <span>{labels.fileContract}</span>
              <span className="tabular-nums text-muted-foreground">{fileContract.length}</span>
            </div>
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto pr-1">
              {fileContract.map((entry) => (
                <li
                  key={`${entry.kind}:${entry.path}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs leading-5"
                >
                  <span className="truncate font-mono text-foreground/80" title={entry.path}>
                    {entry.path}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.kind === 'file' ? labels.file : labels.directory}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="border-t border-foreground/10 pt-4">
          <div className="text-xs font-medium text-foreground/75">{labels.assets}</div>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
            {preview.assets.map((asset) => (
              <span key={asset} className="font-mono text-[11px] leading-5 text-muted-foreground">
                {asset}
              </span>
            ))}
          </div>
        </section>

        <section className="border-t border-foreground/10 pt-4">
          <div className="text-xs font-medium text-foreground/75">{labels.bestFor}</div>
          <p className="mt-2 leading-6 text-muted-foreground">{preview.bestFor}</p>
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
  const [selectedMethodId, setSelectedMethodId] = useState<WorkspaceCreationMethodId>('novel.claude-book')
  const [locationOption, setLocationOption] = useState<WorkspaceCreationLocationOption>('default')
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [homeDir, setHomeDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // Get home directory on mount
  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir)
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
  const selectedMethodPreviewMermaid = selectedMethodOption.fallbackPreviewMermaid
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
                title={option.fallbackTitle}
                subtitle={option.fallbackSubtitle}
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
          mermaidCode={selectedMethodPreviewMermaid}
          fileContract={selectedMethodOption.fileContract}
          labels={{
            logic: "方法逻辑",
            workflow: "流程图",
            structure: "结构层",
            assets: "工作区资产",
            fileContract: "文件契约",
            file: "文件",
            directory: "目录",
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
