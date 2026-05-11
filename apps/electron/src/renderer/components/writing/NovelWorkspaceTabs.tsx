import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NOVEL_WORKSPACE_TABS } from './novel-workspace-config'

export function NovelWorkspaceTabs() {
  const { t } = useTranslation()

  return (
    <TabsList className="h-8 rounded-md bg-foreground/[0.04] p-0.5">
      {NOVEL_WORKSPACE_TABS.map((tab) => (
        <TabsTrigger
          key={tab.id}
          value={tab.id}
          className="h-7 rounded-[5px] px-2.5 text-xs"
        >
          {t(tab.labelKey, tab.fallbackTitle)}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
