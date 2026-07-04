/**
 * EscapeInterruptContext
 *
 * Provides state for the double-Esc interrupt feature.
 * When processing, first Esc shows a warning overlay; second Esc within 1 second interrupts.
 *
 * This is a separate context to avoid prop drilling through the component tree:
 * AppShell -> MainContentPanel -> ChatPage -> ChatDisplay -> InputContainer -> FreeFormInput
 */

import * as React from 'react'
import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

interface EscapeInterruptContextType {
  /** Whether the escape warning overlay should be shown */
  showEscapeOverlay: boolean
  /** Trigger the first escape press - shows overlay and returns false. If already showing, returns true (proceed with interrupt) */
  handleEscapePress: () => boolean
  /** Dismiss the overlay (called after timeout or after interrupt) */
  dismissOverlay: () => void
}

interface EscapeInterruptActionsContextType {
  /** Trigger the first escape press - shows overlay and returns false. If already showing, returns true (proceed with interrupt) */
  handleEscapePress: () => boolean
  /** Dismiss the overlay (called after timeout or after interrupt) */
  dismissOverlay: () => void
}

const EscapeInterruptContext = createContext<EscapeInterruptContextType | null>(null)
const EscapeInterruptActionsContext = createContext<EscapeInterruptActionsContextType | null>(null)

// Time window (ms) for second Esc press to trigger interrupt
const ESC_TIMEOUT_MS = 2000

export function EscapeInterruptProvider({ children }: { children: React.ReactNode }) {
  const [showEscapeOverlay, setShowEscapeOverlay] = useState(false)
  const showEscapeOverlayRef = useRef(showEscapeOverlay)
  showEscapeOverlayRef.current = showEscapeOverlay
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const dismissOverlay = useCallback(() => {
    setShowEscapeOverlay(false)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  /**
   * Handle an Escape key press.
   * Returns true if the caller should proceed with the interrupt (second press within timeout).
   * Returns false if this was the first press (overlay shown, waiting for second press).
   */
  const handleEscapePress = useCallback((): boolean => {
    if (showEscapeOverlayRef.current) {
      // Second press within timeout - proceed with interrupt
      dismissOverlay()
      return true
    }

    // First press - show overlay and start timeout
    setShowEscapeOverlay(true)

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Auto-dismiss after timeout
    timeoutRef.current = setTimeout(() => {
      setShowEscapeOverlay(false)
      timeoutRef.current = null
    }, ESC_TIMEOUT_MS)

    return false
  }, [dismissOverlay])

  const actionsValue = React.useMemo(
    () => ({ handleEscapePress, dismissOverlay }),
    [handleEscapePress, dismissOverlay]
  )

  const value = React.useMemo(
    () => ({ showEscapeOverlay, handleEscapePress, dismissOverlay }),
    [showEscapeOverlay, handleEscapePress, dismissOverlay]
  )

  return (
    <EscapeInterruptActionsContext.Provider value={actionsValue}>
      <EscapeInterruptContext.Provider value={value}>
        {children}
      </EscapeInterruptContext.Provider>
    </EscapeInterruptActionsContext.Provider>
  )
}

export function useEscapeInterrupt(): EscapeInterruptContextType {
  const context = useContext(EscapeInterruptContext)
  if (!context) {
    throw new Error('useEscapeInterrupt must be used within an EscapeInterruptProvider')
  }
  return context
}

export function useEscapeInterruptActions(): EscapeInterruptActionsContextType {
  const context = useContext(EscapeInterruptActionsContext)
  if (!context) {
    throw new Error('useEscapeInterruptActions must be used within an EscapeInterruptProvider')
  }
  return context
}
