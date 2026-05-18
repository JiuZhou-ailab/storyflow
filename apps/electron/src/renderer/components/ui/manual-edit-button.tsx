// input: A file path and optional opener callback
// output: Button that opens the file directly for manual editing
// pos: Small reusable control for file-backed configuration surfaces

import * as React from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { usePlatform } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { Button } from './button'

export interface ManualEditButtonProps {
  label?: string
  filePath: string
  disabled?: boolean
  onOpenFile?: (filePath: string) => void | Promise<void>
  className?: string
}

export function ManualEditButton({
  label = 'Edit File',
  filePath,
  disabled = false,
  onOpenFile,
  className,
}: ManualEditButtonProps) {
  const { onOpenFile: platformOpenFile } = usePlatform()

  const handleClick = React.useCallback(async () => {
    if (disabled) return
    try {
      const openFile = onOpenFile ?? platformOpenFile
      if (!openFile) {
        toast.error('Failed to open file')
        return
      }
      await openFile(filePath)
    } catch (error) {
      toast.error('Failed to open file', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }, [disabled, filePath, onOpenFile, platformOpenFile])

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={label}
      aria-label={label}
      data-testid="manual-edit-file-button"
      disabled={disabled}
      onClick={handleClick}
      className={cn("h-8 px-3 rounded-[6px] bg-background shadow-minimal text-foreground/70 hover:text-foreground", className)}
    >
      <Pencil className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Button>
  )
}
