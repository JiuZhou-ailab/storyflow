// input: User-authored product feedback and pasted screenshots
// output: Dialog that submits feedback through the Electron main process
// pos: App-shell feedback capture surface

import * as React from "react"
import { useTranslation } from "react-i18next"
import { Loader2, MessageSquarePlus, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useRegisterModal } from "@/context/ModalContext"
import { rendererPlatform } from "@/lib/platform"
import appPackage from "../../../../package.json"
import type { FeedbackIssueAttachment } from "../../../shared/types"

type FeedbackDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ScreenshotAttachment = FeedbackIssueAttachment & {
  previewUrl: string
}

function readScreenshot(file: File, index: number): Promise<ScreenshotAttachment | null> {
  if (!file.type.startsWith('image/')) return Promise.resolve(null)

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      const comma = dataUrl.indexOf(',')
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
      if (!base64) {
        resolve(null)
        return
      }

      const extension = file.type.split('/')[1] || 'png'
      resolve({
        name: file.name && file.name !== 'image.png' ? file.name : `pasted-screenshot-${index}.${extension}`,
        mimeType: file.type,
        size: file.size,
        base64,
        previewUrl: dataUrl,
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = React.useState("")
  const [message, setMessage] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [screenshots, setScreenshots] = React.useState<ScreenshotAttachment[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [issueUrl, setIssueUrl] = React.useState<string | null>(null)

  useRegisterModal(open, () => onOpenChange(false))

  const reset = React.useCallback(() => {
    setTitle("")
    setMessage("")
    setEmail("")
    setScreenshots([])
    setSubmitting(false)
    setError(null)
    setIssueUrl(null)
  }, [])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) {
      onOpenChange(false)
      reset()
    } else if (nextOpen) {
      onOpenChange(true)
    }
  }

  const addScreenshots = async (files: File[]) => {
    if (files.length === 0) return
    const availableSlots = Math.max(0, 5 - screenshots.length)
    const selected = files.filter((file) => file.type.startsWith('image/')).slice(0, availableSlots)
    const next = await Promise.all(selected.map((file, index) => readScreenshot(file, screenshots.length + index + 1)))
    const valid = next.filter((item): item is ScreenshotAttachment => item !== null)
    if (valid.length > 0) {
      setScreenshots((prev) => [...prev, ...valid])
      setError(null)
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files)
    if (files.some((file) => file.type.startsWith('image/'))) {
      event.preventDefault()
      void addScreenshots(files)
    }
  }

  const handleSubmit = async () => {
    if (!title.trim() || !message.trim() || submitting) return

    setSubmitting(true)
    setError(null)
    setIssueUrl(null)
    try {
      const result = await window.electronAPI.submitFeedbackIssue({
        title,
        message,
        email,
        appVersion: appPackage.version,
        platform: rendererPlatform,
        attachments: screenshots.map(({ previewUrl: _previewUrl, ...attachment }) => attachment),
      })
      setIssueUrl(result.url)
      onOpenChange(false)
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = title.trim().length > 0 && message.trim().length > 0 && !submitting

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5" />
            {t("feedback.title", "反馈")}
          </DialogTitle>
          <DialogDescription className="text-left">
            {t("feedback.description", "描述你遇到的问题或建议，可以直接粘贴截图。")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4" onPaste={handlePaste}>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="feedback-title">
              {t("feedback.summary", "标题")}
            </label>
            <Input
              id="feedback-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("feedback.summaryPlaceholder", "一句话说明反馈内容")}
              disabled={submitting || !!issueUrl}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="feedback-message">
              {t("feedback.details", "详情")}
            </label>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t("feedback.detailsPlaceholder", "发生了什么？你期望它怎样工作？可直接粘贴截图。")}
              className="min-h-[128px] resize-none"
              disabled={submitting || !!issueUrl}
            />
            {screenshots.length > 0 && (
              <div className="grid grid-cols-5 gap-2 pt-1">
                {screenshots.map((screenshot, index) => (
                  <div key={`${screenshot.name}-${index}`} className="group relative aspect-square overflow-hidden rounded-md border border-foreground/10 bg-foreground/5">
                    <img src={screenshot.previewUrl} alt={screenshot.name} className="h-full w-full object-cover" />
                    {!submitting && !issueUrl && (
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded bg-background/90 p-0.5 opacity-0 shadow-xs transition-opacity group-hover:opacity-100"
                        aria-label={t("common.remove", "移除")}
                        onClick={() => setScreenshots((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="feedback-email">
              {t("feedback.contact", "联系方式")}
              <span className="ml-1 text-muted-foreground">{t("common.optional", "可选")}</span>
            </label>
            <Input
              id="feedback-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("feedback.contactPlaceholder", "方便追问时填写邮箱")}
              disabled={submitting || !!issueUrl}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {issueUrl && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {t("feedback.sent", "反馈已提交到 GitHub issue。")}
            </div>
          )}
        </div>

        <DialogFooter>
          {issueUrl ? (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                {t("common.close")}
              </Button>
              <Button onClick={() => window.electronAPI.openUrl(issueUrl)}>
                {t("feedback.openIssue", "查看 issue")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("feedback.submit", "提交反馈")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
