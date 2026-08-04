/**
 * SkillAvatar - Thin wrapper around EntityIcon for skills.
 *
 * Resolves a semantic fallback from Skill metadata and delegates rendering to EntityIcon.
 * Use `fluid` prop for fill-parent sizing (e.g., Info_Page.Hero).
 */

import {
  BookOpen,
  BrainCircuit,
  Clapperboard,
  Lightbulb,
  ScrollText,
  Search,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import { cn } from '@/lib/utils'
import type { IconSize, ResolvedEntityIcon } from '@craft-agent/shared/icons'
import type { LoadedSkill } from '../../../shared/types'

interface SkillAvatarProps {
  /** LoadedSkill object */
  skill: LoadedSkill
  /** Size variant */
  size?: IconSize
  /** Fill parent container (h-full w-full). Overrides size. */
  fluid?: boolean
  /** Additional className overrides */
  className?: string
  /** Workspace ID for loading local icons */
  workspaceId?: string
}

const SKILL_VISUALS: Array<{
  keywords: string[]
  icon: LucideIcon
  className: string
}> = [
  { keywords: ['人物', '角色', 'character', 'relationship'], icon: Users, className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  { keywords: ['视频', '剧本', 'screenplay', 'video', 'scene'], icon: Clapperboard, className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  { keywords: ['研究', '来源', '核验', 'search', 'research', 'evidence'], icon: Search, className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  { keywords: ['世界', '系统', 'system', 'world'], icon: BrainCircuit, className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  { keywords: ['故事', '剧情', '大纲', 'plot', 'story', 'outline'], icon: BookOpen, className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  { keywords: ['编辑', '写作', '正文', '文档', 'edit', 'writing', 'document'], icon: ScrollText, className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
  { keywords: ['灵感', '创意', 'idea', 'ideation'], icon: Lightbulb, className: 'bg-orange-500/10 text-orange-700 dark:text-orange-300' },
]

export interface SkillVisual {
  icon: LucideIcon
  className: string
}

interface SkillVisualAvatarProps {
  visual: SkillVisual
  icon?: ResolvedEntityIcon
  size?: IconSize
  fluid?: boolean
  className?: string
  alt?: string
}

const FALLBACK_SKILL_ICON: ResolvedEntityIcon = { kind: 'fallback', colorable: false }

export function resolveSkillVisual(searchableParts: Array<string | undefined>): SkillVisual {
  const searchable = searchableParts.filter(Boolean).join(' ').toLocaleLowerCase()
  return SKILL_VISUALS.find(item => item.keywords.some(keyword => searchable.includes(keyword)))
    ?? { icon: Sparkles, className: 'bg-foreground/[0.05] text-muted-foreground' }
}

export function SkillVisualAvatar({
  visual,
  icon = FALLBACK_SKILL_ICON,
  size = 'md',
  fluid,
  className,
  alt,
}: SkillVisualAvatarProps) {
  const FallbackIcon = visual.icon

  return (
    <EntityIcon
      icon={icon}
      size={size}
      fallbackIcon={visual.icon}
      fallback={<FallbackIcon className="h-full w-full p-0.5" />}
      alt={alt}
      className={cn(icon.kind === 'fallback' && visual.className, className)}
      containerClassName={fluid ? 'h-full w-full' : undefined}
    />
  )
}

export function SkillAvatar({ skill, size = 'md', fluid, className, workspaceId }: SkillAvatarProps) {
  const icon = useEntityIcon({
    workspaceId: workspaceId ?? '',
    entityType: 'skill',
    identifier: skill.slug,
    iconPath: skill.iconPath,
    iconValue: skill.metadata.icon,
  })
  const visual = resolveSkillVisual([
    skill.slug,
    skill.metadata.displayName,
    skill.metadata.name,
    skill.metadata.description,
  ])

  return (
    <SkillVisualAvatar
      visual={visual}
      icon={icon}
      size={size}
      fluid={fluid}
      className={className}
      alt={skill.metadata.displayName ?? skill.metadata.name}
    />
  )
}
