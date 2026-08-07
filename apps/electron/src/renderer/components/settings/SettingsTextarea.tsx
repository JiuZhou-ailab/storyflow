// input: Multiline setting values, labels, limits, and change handlers
// output: Compact resizable textareas with optional character feedback
// pos: Shared renderer control for long-form settings content

/**
 * SettingsTextarea
 *
 * Multiline text input with label and optional character count.
 */

import * as React from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsTextareaProps {
  /** Textarea label */
  label?: string
  /** Optional description below label */
  description?: string
  /** Current value */
  value: string
  /** Change handler */
  onChange: (value: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Maximum character length */
  maxLength?: number
  /** Number of visible rows */
  rows?: number
  /** Disabled state */
  disabled?: boolean
  /** Error message */
  error?: string
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
}

/**
 * SettingsTextarea - Multiline text input with character count
 *
 * @example
 * <SettingsTextarea
 *   label="Notes"
 *   description="Additional context for the AI assistant"
 *   value={notes}
 *   onChange={setNotes}
 *   maxLength={2000}
 *   rows={4}
 * />
 */
export function SettingsTextarea({
  label,
  description,
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 4,
  disabled,
  error,
  className,
  inCard = false,
}: SettingsTextareaProps) {
  const id = React.useId()
  const errorId = `${id}-error`
  const charCount = value.length
  const isOverLimit = maxLength !== undefined && charCount > maxLength

  return (
    <div
      className={cn(
        'space-y-1',
        inCard && 'px-4 py-3',
        className
      )}
    >
      {label && (
        <div className={settingsUI.labelGroup}>
          <Label htmlFor={id} className={settingsUI.label}>
            {label}
          </Label>
          {description && (
            <p className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
          )}
        </div>
      )}
      <div className="relative">
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          aria-invalid={Boolean(error || isOverLimit)}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'min-h-[120px] resize-y border-foreground/10 bg-muted/40 shadow-none hover:bg-muted/60 focus-visible:border-foreground/25 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-foreground/50',
            (error || isOverLimit) && 'border-destructive focus-visible:ring-destructive/20',
            maxLength && 'pb-6'
          )}
        />
        {maxLength !== undefined && (
          <div
            className={cn(
              'absolute bottom-2 right-3 text-xs',
              isOverLimit ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {charCount}/{maxLength}
          </div>
        )}
      </div>
      {error && <p id={errorId} className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
