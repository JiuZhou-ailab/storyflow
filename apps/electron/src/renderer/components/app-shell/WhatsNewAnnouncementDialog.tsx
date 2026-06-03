// input: Short What's New announcement copy and dialog callbacks
// output: App-native update announcement dialog for the first launch after an update
// pos: Lightweight renderer surface between startup policy and full release notes overlay

import * as React from 'react'
import { Megaphone } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WhatsNewAnnouncementCopy } from './whats-new-announcement'

interface WhatsNewAnnouncementDialogProps {
  open: boolean
  copy: WhatsNewAnnouncementCopy | null
  accentColor?: string
  accentTextColor?: string
  onOpenChange: (open: boolean) => void
  onShowDetails: () => void
}

export function WhatsNewAnnouncementDialog({
  open,
  copy,
  accentColor,
  accentTextColor,
  onOpenChange,
  onShowDetails,
}: WhatsNewAnnouncementDialogProps) {
  if (!copy) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader className="gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[8px]"
            style={{
              backgroundColor: accentColor ?? '#2563eb',
              color: accentTextColor ?? '#ffffff',
            }}
          >
            <Megaphone className="h-[18px] w-[18px]" />
          </div>
          <div className="space-y-2">
            <DialogTitle className="text-[18px] leading-6">{copy.title}</DialogTitle>
            <DialogDescription className="text-[14px] leading-6">
              {copy.summary}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onShowDetails}>
            {copy.secondaryActionLabel}
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            {copy.primaryActionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
