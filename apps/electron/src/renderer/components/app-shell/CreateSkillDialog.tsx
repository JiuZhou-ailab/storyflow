// input: Runtime workspace id, owner scope, and existing Skill slugs
// output: Validated global or project Skill created through the Skills RPC
// pos: Direct Skill creation surface without generic filesystem write access

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { navigate, routes } from '@/lib/navigate'

export interface CreateSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  scope: 'global' | 'project'
  existingSlugs?: string[]
}

/** Agent Skills-compatible slug: lowercase letters, digits, single hyphens. */
export function toSkillSlug(input: string): string {
  const ascii = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return ascii
}

export function buildSkillMarkdown(opts: {
  slug: string
  displayName: string
  description: string
}): string {
  const displayName = opts.displayName.trim() || opts.slug
  const description = opts.description.trim() || `Skill: ${displayName}`
  // name must equal directory slug for validation
  return `---
name: ${opts.slug}
description: ${JSON.stringify(description)}
metadata:
  displayName: ${JSON.stringify(displayName)}
---

# ${displayName}

## When to use

${description}

## Instructions

1. Restate the user's goal in one sentence.
2. Follow the project conventions under the workspace root.
3. Prefer editing existing files over creating new ones unless asked.
`
}

export function CreateSkillDialog({
  open,
  onOpenChange,
  workspaceId,
  scope,
  existingSlugs = [],
}: CreateSkillDialogProps) {
  const { t } = useTranslation()
  const [displayName, setDisplayName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const existing = React.useMemo(() => new Set(existingSlugs), [existingSlugs])

  React.useEffect(() => {
    if (!open) return
    setDisplayName('')
    setDescription('')
    setSlug('')
    setSlugTouched(false)
    setSubmitting(false)
  }, [open])

  React.useEffect(() => {
    if (slugTouched) return
    setSlug(toSkillSlug(displayName))
  }, [displayName, slugTouched])

  const finalSlug = slug || toSkillSlug(displayName)
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finalSlug)
  const canSubmit = Boolean(displayName.trim() && description.trim() && slugValid && !existing.has(finalSlug))

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit || submitting) return

    const content = buildSkillMarkdown({
      slug: finalSlug,
      displayName: displayName.trim(),
      description: description.trim(),
    })

    setSubmitting(true)
    try {
      await window.electronAPI.createSkill(workspaceId, finalSlug, content)
      toast.success(`已创建技能：${displayName.trim()}`)
      onOpenChange(false)
      navigate(routes.view.skills(finalSlug))
    } catch (error) {
      toast.error('创建技能失败', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={submitting}>
      <DialogContent size="md" data-testid="create-skill-dialog">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('skillsList.addSkill', '添加技能')}</DialogTitle>
            <DialogDescription>
              {scope === 'project'
                ? '直接在当前项目创建 Skill 文件。项目 Skill 会覆盖同名全局 Skill。'
                : '创建全局 Skill，所有自由对话和项目都可使用。'}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="skill-display-name">{t('common.name', '名称')}</Label>
              <Input
                id="skill-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例如：章节衔接检查"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="skill-slug">
                {t('common.slug', '技能 ID')}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  小写英文，对应文件夹名
                </span>
              </Label>
              <Input
                id="skill-slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(toSkillSlug(e.target.value) || e.target.value.toLowerCase())
                }}
                placeholder="chapter-continuity"
                className="font-mono text-[13px]"
              />
              {displayName.trim() && finalSlug ? (
                <p className="text-[11px] text-muted-foreground">
                  {existing.has(finalSlug)
                    ? '该技能 ID 已存在'
                    : (
                      <>
                        {scope === 'project' ? '项目 Skill' : '全局 Skill'}{' '}
                        <span className="font-mono">{finalSlug}</span>
                      </>
                    )}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="skill-description">{t('common.description', '描述')}</Label>
              <Textarea
                id="skill-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="何时使用这个技能？它应该完成什么？"
                rows={3}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter className="mt-5">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t('common.cancel', '取消')}
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting
                ? t('common.loading', '创建中…')
                : t('common.create', '创建技能')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
