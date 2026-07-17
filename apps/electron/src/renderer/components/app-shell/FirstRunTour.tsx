// input: App-shell DOM targets annotated with data-tutorial
// output: Dismissible first-run guide overlay
// pos: Teaches the main workspace controls after a user creates or opens a project

import * as React from 'react'
import { X } from 'lucide-react'
import { FIRST_RUN_TOUR_STEPS } from '@/lib/first-run-tour'
import * as storage from '@/lib/local-storage'
import { cn } from '@/lib/utils'

interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

function getTargetRect(selector: string): TargetRect | null {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) return null
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function getPanelPosition(rect: TargetRect | null) {
  const margin = 16
  const panelWidth = Math.min(340, window.innerWidth - margin * 2)
  if (!rect) {
    return {
      width: panelWidth,
      top: Math.max(margin, window.innerHeight / 2 - 120),
      left: Math.max(margin, window.innerWidth / 2 - panelWidth / 2),
    }
  }

  const preferRight = rect.left + rect.width + panelWidth + margin < window.innerWidth
  const preferBelow = rect.top + rect.height + 180 + margin < window.innerHeight
  const left = preferRight
    ? rect.left + rect.width + margin
    : Math.min(Math.max(margin, rect.left), window.innerWidth - panelWidth - margin)
  const top = preferBelow
    ? rect.top + rect.height + margin
    : Math.min(Math.max(margin, rect.top - 12), window.innerHeight - 180 - margin)

  return { width: panelWidth, top, left }
}

function SpotlightBackdrop({ rect }: { rect: TargetRect | null }) {
  if (!rect) {
    return <div className="absolute inset-0 bg-black/30" />
  }

  const top = Math.max(0, rect.top - 6)
  const left = Math.max(0, rect.left - 6)
  const right = Math.min(window.innerWidth, rect.left + rect.width + 6)
  const bottom = Math.min(window.innerHeight, rect.top + rect.height + 6)

  return (
    <>
      <div className="absolute inset-x-0 top-0 bg-black/30" style={{ height: top }} />
      <div className="absolute inset-x-0 bottom-0 bg-black/30" style={{ top: bottom }} />
      <div className="absolute left-0 bg-black/30" style={{ top, width: left, height: bottom - top }} />
      <div className="absolute right-0 bg-black/30" style={{ top, left: right, height: bottom - top }} />
      <div
        className="absolute rounded-[10px] border border-accent/70"
        style={{ top, left, width: right - left, height: bottom - top }}
      />
    </>
  )
}

export function FirstRunTour() {
  const [isVisible, setIsVisible] = React.useState(() => (
    storage.get(storage.KEYS.firstRunTourPending, false)
    && !storage.get(storage.KEYS.firstRunTourCompleted, false)
  ))
  const [stepIndex, setStepIndex] = React.useState(0)
  const [targetRect, setTargetRect] = React.useState<TargetRect | null>(null)

  const currentStep = FIRST_RUN_TOUR_STEPS[stepIndex]

  const complete = React.useCallback(() => {
    storage.set(storage.KEYS.firstRunTourCompleted, true)
    storage.set(storage.KEYS.firstRunTourPending, false)
    setIsVisible(false)
  }, [])

  const refreshTarget = React.useCallback(() => {
    if (!currentStep) return
    const rect = getTargetRect(currentStep.selector)
    if (rect) {
      setTargetRect(rect)
      return
    }

    const nextIndex = FIRST_RUN_TOUR_STEPS.findIndex((step, index) => index > stepIndex && getTargetRect(step.selector))
    if (nextIndex >= 0) {
      setStepIndex(nextIndex)
    } else {
      setTargetRect(null)
    }
  }, [currentStep, stepIndex])

  React.useEffect(() => {
    if (!isVisible) return
    const raf = window.requestAnimationFrame(refreshTarget)
    window.addEventListener('resize', refreshTarget)
    window.addEventListener('scroll', refreshTarget, true)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', refreshTarget)
      window.removeEventListener('scroll', refreshTarget, true)
    }
  }, [isVisible, refreshTarget])

  if (!isVisible || !currentStep) return null

  const panelPosition = getPanelPosition(targetRect)
  const isLastStep = stepIndex === FIRST_RUN_TOUR_STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] pointer-events-none">
      <SpotlightBackdrop rect={targetRect} />
      <section
        className={cn(
          'pointer-events-auto absolute rounded-[8px] border border-border bg-background p-4',
          'shadow-modal-small'
        )}
        style={panelPosition}
        role="dialog"
        aria-live="polite"
        aria-label="新手指导"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {stepIndex + 1} / {FIRST_RUN_TOUR_STEPS.length}
            </div>
            <h2 className="mt-1 text-sm font-semibold text-foreground">{currentStep.title}</h2>
          </div>
          <button
            type="button"
            onClick={complete}
            className="rounded-[6px] p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            aria-label="关闭新手指导"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{currentStep.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={complete}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            跳过
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex(index => Math.max(0, index - 1))}
                className="rounded-[6px] px-3 py-1.5 text-sm text-foreground hover:bg-foreground/5"
              >
                上一步
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLastStep) {
                  complete()
                } else {
                  setStepIndex(index => Math.min(FIRST_RUN_TOUR_STEPS.length - 1, index + 1))
                }
              }}
              className="rounded-[6px] bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
            >
              {isLastStep ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
