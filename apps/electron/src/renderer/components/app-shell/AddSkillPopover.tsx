// input: Active workspace identity and a caller-owned trigger
// output: Skill Creator conversation popover scoped to the active Storyflow runtime
// pos: Shared native entry for creating a user-level Pi Skill

import * as React from 'react'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import type { Workspace } from '../../../shared/types'

export function AddSkillPopover({
  workspace,
  trigger,
}: {
  workspace: Workspace
  trigger: React.ReactNode
}) {
  return (
    <EditPopover
      trigger={trigger}
      {...getEditConfig('add-skill', '~/.pi/agent')}
      conversationWorkspaceId={workspace.id}
      workingDirectory="none"
    />
  )
}
