// input: Entry target, draft name, busy state, and creation/cancel callbacks
// output: Workspace file/folder creation dialog with IME-safe submission
// pos: Presentation for useWritingWorkspaceState; contains no filesystem state

import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { WorkspaceCreateEntryTarget } from './useWorkspaceProjectSurface'

export function WorkspaceCreateEntryDialog({ target, value, busy, onValueChange, onClose, onSubmit }: {
  target: WorkspaceCreateEntryTarget | null
  value: string
  busy: boolean
  onValueChange: (value: string) => void
  onClose: () => void
  onSubmit: () => Promise<void>
}) {
  const { t } = useTranslation()
  return (
      <Dialog
        open={!!target}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) {
            onClose()
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{target?.title}</DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <Input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={target?.placeholder}
              disabled={busy}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault()
                  void onSubmit()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                onClose()
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy || !value.trim()}
              onClick={() => void onSubmit()}
            >
              {t('common.create', '创建')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  )
}
