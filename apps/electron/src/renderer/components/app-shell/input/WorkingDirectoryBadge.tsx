// input: Session working directory, project identity, and directory update callback
// output: Filterable working-directory selector with local and remote folder pickers
// pos: Reusable project context control for chat input layouts

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Command as CommandPrimitive } from 'cmdk'
import { Check, X } from 'lucide-react'
import { Icon_Folder, Icon_Home } from '@craft-agent/ui'

import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { cn } from '@/lib/utils'
import { getPathBasename, PATH_SEP } from '@/lib/platform'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import {
  addRecentWorkingDir,
  createRecentWorkingDirItems,
  getRecentWorkingDirs,
  removeRecentWorkingDir,
} from './working-directory-history'

function formatPathForDisplay(path: string, homeDir: string): string {
  let displayPath = path
  if (homeDir && path.startsWith(homeDir)) {
    const relativePath = path.slice(homeDir.length)
    displayPath = relativePath.startsWith(PATH_SEP)
      ? relativePath.slice(1)
      : (relativePath || PATH_SEP)
  }
  return `in ${displayPath}`
}

export function WorkingDirectoryBadge({
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  isExpanded = false,
  workspaceId,
}: {
  workingDirectory?: string
  onWorkingDirectoryChange: (path: string) => void
  sessionFolderPath?: string
  isExpanded?: boolean
  workspaceId?: string
}) {
  const { t } = useTranslation()
  const [recentDirs, setRecentDirs] = React.useState<string[]>([])
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [homeDir, setHomeDir] = React.useState('')
  const [gitBranch, setGitBranch] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setRecentDirs(getRecentWorkingDirs(workspaceId))
    window.electronAPI?.getHomeDir?.().then((dir: string) => {
      if (dir) setHomeDir(dir)
    })
  }, [workspaceId])

  React.useEffect(() => {
    if (workingDirectory) {
      window.electronAPI?.getGitBranch?.(workingDirectory).then((branch: string | null) => {
        setGitBranch(branch)
      })
    } else {
      setGitBranch(null)
    }
  }, [workingDirectory])

  React.useEffect(() => {
    if (!popoverOpen) return

    setFilter('')
    setRecentDirs(getRecentWorkingDirs(workspaceId))
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [popoverOpen, workspaceId])

  const handleFolderSelected = React.useCallback((selectedPath: string) => {
    setRecentDirs(addRecentWorkingDir(selectedPath, workspaceId))
    onWorkingDirectoryChange(selectedPath)
  }, [onWorkingDirectoryChange, workspaceId])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected)

  const handleChooseFolder = () => {
    setPopoverOpen(false)
    pickDirectory()
  }

  const handleSelectRecent = (path: string) => {
    setRecentDirs(addRecentWorkingDir(path, workspaceId))
    onWorkingDirectoryChange(path)
    setPopoverOpen(false)
  }

  const handleReset = () => {
    if (sessionFolderPath) {
      onWorkingDirectoryChange(sessionFolderPath)
      setPopoverOpen(false)
    }
  }

  const handleRemoveRecent = (event: React.MouseEvent, path: string) => {
    event.stopPropagation()
    setRecentDirs(removeRecentWorkingDir(path, workspaceId))
  }

  const filteredRecent = React.useMemo(
    () => createRecentWorkingDirItems(recentDirs, workingDirectory),
    [recentDirs, workingDirectory],
  )
  const showFilter = filteredRecent.length > 5
  const hasFolder = !!workingDirectory && workingDirectory !== sessionFolderPath
  const folderName = hasFolder ? (getPathBasename(workingDirectory) || 'Folder') : 'Work in Folder'
  const showReset = hasFolder && sessionFolderPath && sessionFolderPath !== workingDirectory
  const menuContainerClass = 'min-w-[200px] max-w-[400px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small p-0'
  const menuListClass = 'max-h-[200px] overflow-y-auto p-1 [&_[cmdk-list-sizer]]:space-y-px'
  const menuItemClass = 'flex cursor-pointer select-none items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] outline-none'

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <FreeFormInputContextBadge
            aria-label={`${t('chat.workingDirectory')}: ${folderName}`}
            icon={<Icon_Home className="h-4 w-4" />}
            label={folderName}
            isExpanded={isExpanded}
            hasSelection={hasFolder}
            showChevron
            isOpen={popoverOpen}
            tooltip={
              hasFolder ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{t('chat.workingDirectory')}</span>
                  <span className="text-xs opacity-70">{formatPathForDisplay(workingDirectory, homeDir)}</span>
                  {gitBranch && <span className="text-xs opacity-70">{t('chat.onBranch', { branch: gitBranch })}</span>}
                </span>
              ) : t('chat.chooseWorkingDirectory')
            }
          />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={8} className={menuContainerClass}>
          <CommandPrimitive shouldFilter={showFilter}>
            {showFilter && (
              <div className="border-b border-border/50 px-3 py-2">
                <CommandPrimitive.Input
                  ref={inputRef}
                  value={filter}
                  onValueChange={setFilter}
                  placeholder={t('chat.filterFolders')}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 placeholder:select-none"
                />
              </div>
            )}

            <CommandPrimitive.List className={menuListClass}>
              {hasFolder && (
                <CommandPrimitive.Item
                  value={`current-${workingDirectory}`}
                  className={cn(menuItemClass, 'pointer-events-none bg-foreground/5')}
                  disabled
                >
                  <Icon_Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    <span>{folderName}</span>
                    <span className="ml-1.5 text-muted-foreground">{formatPathForDisplay(workingDirectory, homeDir)}</span>
                  </span>
                  <Check className="h-4 w-4 shrink-0" />
                </CommandPrimitive.Item>
              )}

              {hasFolder && filteredRecent.length > 0 && (
                <div className="mx-1 my-1 h-px bg-border" />
              )}

              {filteredRecent.map(({ path, name: recentFolderName }) => (
                <CommandPrimitive.Item
                  key={path}
                  value={`${recentFolderName} ${path}`}
                  onSelect={() => handleSelectRecent(path)}
                  className={cn(menuItemClass, 'group/item data-[selected=true]:bg-foreground/5')}
                >
                  <Icon_Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    <span>{recentFolderName}</span>
                    <span className="ml-1.5 text-muted-foreground">{formatPathForDisplay(path, homeDir)}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`移除最近目录 ${recentFolderName}`}
                    onClick={(event) => handleRemoveRecent(event, path)}
                    className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground group-hover/item:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </CommandPrimitive.Item>
              ))}

              {showFilter && (
                <CommandPrimitive.Empty className="py-3 text-center text-sm text-muted-foreground">
                  {t('chat.noFoldersFound')}
                </CommandPrimitive.Empty>
              )}
            </CommandPrimitive.List>

            <div className="border-t border-border/50 p-1">
              <button
                type="button"
                onClick={handleChooseFolder}
                className={cn(menuItemClass, 'w-full hover:bg-foreground/5')}
              >
                {t('chat.chooseFolder')}
              </button>
              {showReset && (
                <button
                  type="button"
                  onClick={handleReset}
                  className={cn(menuItemClass, 'w-full hover:bg-foreground/5')}
                >
                  {t('common.reset')}
                </button>
              )}
            </div>
          </CommandPrimitive>
        </PopoverContent>
      </Popover>
      <ServerDirectoryBrowser
        open={showServerBrowser}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
        initialPath={workingDirectory}
      />
    </>
  )
}
