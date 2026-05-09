import * as React from 'react'
import { ChevronDown, MessageSquareText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface WritingChatDropdownProps {
  children: React.ReactNode
}

export function WritingChatDropdown({ children }: WritingChatDropdownProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className="h-7 rounded-[6px] px-2 text-xs">
          <MessageSquareText className="h-3.5 w-3.5" />
          {t('writing.openChat')}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="h-[min(620px,calc(100vh-120px))] w-[min(760px,calc(100vw-80px))] overflow-hidden rounded-[8px] border-border/70 p-0 shadow-2xl">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
