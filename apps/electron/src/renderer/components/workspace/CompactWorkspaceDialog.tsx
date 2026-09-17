// input: Existing project header, document surface, directory and save-aware close callback
// output: Keyboard-accessible compact project workspace
// pos: Responsive presentation only; editing and file state stay with the workspace owner
import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'

export function CompactWorkspaceDialog({ open, onClose, header, directory, children }: {
  open: boolean
  onClose: () => void
  header: ReactNode
  directory?: ReactNode
  children: ReactNode
}) {
  return <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} className="flex h-[100dvh] max-w-full flex-col gap-0 rounded-none p-0 sm:max-w-full">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <DialogTitle className="text-sm">项目文件</DialogTitle>
        <Button variant="ghost" onClick={onClose}>返回对话</Button>
      </div>
      <div className="min-h-0 flex-1">
        <div className="flex h-full min-w-0 flex-col">
          {header}
          {directory && <div className="max-h-44 shrink-0 overflow-auto border-b border-foreground/[0.06]">{directory}</div>}
          <div className="min-h-0 min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
}
