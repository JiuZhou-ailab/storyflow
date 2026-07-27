// input: Structured agent questions and a response callback
// output: Accessible option and free-form answer form
// pos: Human-in-the-loop structured chat input for ask_user_question

import * as React from 'react'
import { CircleHelp, Send, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { UserQuestionRequest as UserQuestionRequestType } from '../../../../../shared/types'
import type { UserQuestionResponse } from './types'

interface UserQuestionRequestProps {
  request: UserQuestionRequestType
  onResponse: (response: UserQuestionResponse) => void
  unstyled?: boolean
}

export function UserQuestionRequest({
  request,
  onResponse,
  unstyled = false,
}: UserQuestionRequestProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = React.useState<Record<string, string[]>>({})
  const [custom, setCustom] = React.useState<Record<string, string>>({})

  const buildAnswers = React.useCallback(() => Object.fromEntries(
    request.questions.flatMap((question) => {
      const freeform = custom[question.question]?.trim()
      const choices = selected[question.question] ?? []
      const answer = freeform || choices.join(', ')
      return answer ? [[question.question, answer]] : []
    }),
  ), [custom, request.questions, selected])

  const answers = buildAnswers()
  const canSubmit = Object.keys(answers).length === request.questions.length

  return (
    <div className={cn(
      'flex h-full flex-col overflow-hidden bg-info/5',
      !unstyled && 'rounded-[8px] border border-info/30 shadow-middle',
    )}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CircleHelp className="h-4 w-4 text-info" />
          {t('chat.questionRequired', '需要你的选择')}
        </div>
        {request.questions.map((question) => (
          <fieldset key={question.question} className="space-y-2">
            <legend className="text-xs font-medium text-foreground">
              <span className="mr-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {question.header}
              </span>
              {question.question}
            </legend>
            <div className="grid gap-1.5">
              {question.options.map((option) => {
                const checked = selected[question.question]?.includes(option.label) ?? false
                return (
                  <label
                    key={option.label}
                    className={cn(
                      'flex cursor-pointer gap-2 rounded-md border px-3 py-2 text-xs transition-colors',
                      checked ? 'border-info/50 bg-info/10' : 'border-border/50 bg-background hover:bg-muted/40',
                    )}
                  >
                    <input
                      type={question.multiSelect ? 'checkbox' : 'radio'}
                      name={question.question}
                      checked={checked}
                      onChange={() => {
                        setCustom(current => ({ ...current, [question.question]: '' }))
                        setSelected(current => {
                          const existing = current[question.question] ?? []
                          return {
                            ...current,
                            [question.question]: question.multiSelect
                              ? checked
                                ? existing.filter(value => value !== option.label)
                                : [...existing, option.label]
                              : [option.label],
                          }
                        })
                      }}
                    />
                    <span>
                      <span className="font-medium text-foreground">{option.label}</span>
                      <span className="ml-1.5 text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                )
              })}
              <input
                value={custom[question.question] ?? ''}
                onChange={(event) => {
                  setSelected(current => ({ ...current, [question.question]: [] }))
                  setCustom(current => ({ ...current, [question.question]: event.target.value }))
                }}
                placeholder={t('chat.questionOther', '其他答案…')}
                className="h-8 rounded-md border border-border/50 bg-background px-3 text-xs outline-none focus:border-info/60"
              />
            </div>
          </fieldset>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border/50 px-3 py-2">
        <Button
          size="sm"
          className="h-7 gap-1.5"
          disabled={!canSubmit}
          onClick={() => onResponse({ type: 'user_question', answers })}
        >
          <Send className="h-3.5 w-3.5" />
          {t('common.submit', '提交')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5"
          onClick={() => onResponse({ type: 'user_question', answers: {}, cancelled: true })}
        >
          <X className="h-3.5 w-3.5" />
          {t('common.cancel', '取消')}
        </Button>
      </div>
    </div>
  )
}
