// input: Radio selection state, a title, supporting copy, and optional trailing action
// output: Accessible workspace-choice row with standard or embedded compact styling
// pos: Shared selection primitive for workspace creation forms

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface AddWorkspace_RadioOptionProps {
  name: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  title: string
  subtitle?: string | ReactNode
  action?: ReactNode
  /**
   * Embedded form: soft fill rows only.
   * No borders on the row — selected state is background only.
   */
  compact?: boolean
}

interface AddWorkspace_RadioGroupProps {
  children: ReactNode
  className?: string
  "aria-label"?: string
}

/**
 * Compact radio list shell.
 * Intentionally borderless: no outer frame, no divide-y.
 * Selection is communicated by row fill only (avoids stacked strokes).
 */
export function AddWorkspace_RadioGroup({
  children,
  className,
  "aria-label": ariaLabel,
}: AddWorkspace_RadioGroupProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("flex flex-col gap-0.5", className)}
    >
      {children}
    </div>
  )
}

/**
 * AddWorkspace_RadioOption - Shared radio button component for workspace creation flows
 *
 * Used in:
 * - AddWorkspaceStep_OpenFolder: Browse/Create folder options + Location selection
 * - AddWorkspaceStep_CreateNew: Location selection
 */
export function AddWorkspace_RadioOption({
  name,
  checked,
  onChange,
  disabled = false,
  title,
  subtitle,
  action,
  compact = false,
}: AddWorkspace_RadioOptionProps) {
  const hasSubtitle = subtitle != null && subtitle !== ""

  return (
    <label
      className={cn(
        "group flex cursor-pointer items-start gap-2.5 transition-colors duration-150",
        compact
          ? cn(
              "rounded-lg px-2.5 py-2",
              // Fill only — never border / ring / inset stroke on the row.
              checked
                ? "bg-accent/[0.10]"
                : "bg-transparent hover:bg-foreground/[0.04]",
            )
          : cn(
              "rounded-lg bg-background p-3 shadow-minimal",
              checked ? "hover:bg-accent/5" : "hover:bg-foreground/5",
            ),
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      <div
        className={cn(
          "mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
          checked
            ? "border-accent"
            : "border-foreground/30 group-hover:border-foreground/45",
        )}
        aria-hidden
      >
        {checked ? <div className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "font-medium leading-5 text-foreground",
            compact ? "text-[13px]" : "text-sm",
          )}
        >
          {title}
        </div>
        {hasSubtitle ? (
          <div
            className={cn(
              "text-muted-foreground",
              compact ? "mt-0.5 text-[11px] leading-[1.35]" : "mt-[-1px] text-xs",
            )}
          >
            {typeof subtitle === "string" ? (
              <div className={compact ? "line-clamp-2" : "truncate"}>{subtitle}</div>
            ) : (
              subtitle
            )}
          </div>
        ) : null}
      </div>
      {action ? <div className="mt-0.5 shrink-0 self-center">{action}</div> : null}
    </label>
  )
}
