// input: Electron preload API and renderer startup container
// output: React root with client auth gating before the workspace App mounts
// pos: Renderer entrypoint for the desktop application

import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider, useAtomValue } from 'jotai'
import { ThemeProvider } from './context/ThemeContext'
import { windowWorkspaceIdAtom } from './atoms/sessions'
import { Toaster } from '@/components/ui/sonner'
import { setupI18nLazy } from '@craft-agent/shared/i18n/lazy'
import { initReactI18next } from 'react-i18next'
import { useTranslation } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { getDefaultColorThemeForPlatform, rendererPlatform } from '@/lib/platform'
import type { ClientAuthState } from '../shared/types'
import './index.css'

const App = React.lazy(() => import('./App'))
const ClientAuthGate = React.lazy(async () => {
  const module = await import('@/components/auth/ClientAuthGate')
  return { default: module.ClientAuthGate }
})

document.documentElement.dataset.platform = rendererPlatform

// Known-harmless console messages that should NOT be sent to Sentry.
// These are dev-mode noise or expected warnings that aren't actionable.
const IGNORED_CONSOLE_PATTERNS = [
  // React StrictMode dev warnings about non-boolean DOM attributes
  'Received `true` for a non-boolean attribute',
  'Received `false` for a non-boolean attribute',
  // Duplicate Shiki theme registration (expected on HMR reload)
  'theme name already registered',
]

let monitoringPromise: Promise<typeof import('@sentry/react')> | null = null

function initializeRendererMonitoring(): Promise<typeof import('@sentry/react')> {
  monitoringPromise ??= Promise.all([
    import('@sentry/electron/renderer'),
    import('@sentry/react'),
  ]).then(([electronSentry, reactSentry]) => {
    electronSentry.init(
      {
        integrations: [reactSentry.captureConsoleIntegration({ levels: ['error'] })],
        beforeSend(event) {
          const message = event.message || event.exception?.values?.[0]?.value || ''
          if (IGNORED_CONSOLE_PATTERNS.some((pattern) => message.includes(pattern))) return null

          for (const breadcrumb of event.breadcrumbs ?? []) {
            for (const key of Object.keys(breadcrumb.data ?? {})) {
              const lowerKey = key.toLowerCase()
              if (
                lowerKey.includes('token') ||
                lowerKey.includes('key') ||
                lowerKey.includes('secret') ||
                lowerKey.includes('password') ||
                lowerKey.includes('credential') ||
                lowerKey.includes('auth')
              ) {
                breadcrumb.data![key] = '[REDACTED]'
              }
            }
          }
          return event
        },
      },
      reactSentry.init,
    )
    return reactSentry
  })
  return monitoringPromise
}

/**
 * Minimal fallback UI shown when the entire React tree crashes.
 * The local boundary stays in the critical bundle; monitoring loads only after a crash.
 */
function CrashFallback() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">{t('errors.somethingWentWrong')}</p>
      <p className="text-[13px]">{t('errors.restartAppReported')}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-1.5 rounded-md bg-background shadow-minimal text-[13px] text-foreground/70 cursor-pointer"
      >
        {t('common.reload')}
      </button>
    </div>
  )
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void initializeRendererMonitoring().then((monitoring) => {
      monitoring.captureException(error, {
        contexts: { react: { componentStack: info.componentStack } },
      })
    })
  }

  render() {
    return this.state.crashed ? <CrashFallback /> : this.props.children
  }
}

function AppLoadingFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
      正在打开工作区
    </div>
  )
}

function ClientAuthBootstrap({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ClientAuthState | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const accept = (nextState: ClientAuthState) => {
      if (cancelled) return
      setLoadError(null)
      setState(nextState)
    }

    if (!window.electronAPI?.getClientAuthState) {
      accept({
        required: false,
        configured: false,
        authenticated: true,
        emailPasswordEnabled: false,
        emailSignUpEnabled: false,
        feishuLoginEnabled: false,
      })
      return () => { cancelled = true }
    }

    window.electronAPI.getClientAuthState()
      .then(accept)
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    const unsubscribe = window.electronAPI.onClientAuthStateChanged?.(accept)
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const gateActive = loadError != null || !state || (state.required && !state.authenticated)
  React.useEffect(() => {
    if (!gateActive) return
    return window.electronAPI.onCloseRequested?.(() => {
      window.electronAPI.confirmCloseWindow?.()
    })
  }, [gateActive])

  if (loadError) {
    return <div className="flex h-screen items-center justify-center text-sm text-destructive">鉴权初始化失败：{loadError}</div>
  }
  if (!state) return <AppLoadingFallback />
  if (!state.required || state.authenticated) return <>{children}</>

  return (
    <React.Suspense fallback={<AppLoadingFallback />}>
      <ClientAuthGate>{children}</ClientAuthGate>
    </React.Suspense>
  )
}

/**
 * Root component - loads workspace ID for theme context and renders App
 * App.tsx handles window mode detection internally (main vs tab-content)
 */
function Root() {
  // Shared atom — written by App on init & workspace switch, read here for ThemeProvider
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)

  return (
    <ThemeProvider
      activeWorkspaceId={workspaceId}
      defaultColorTheme={getDefaultColorThemeForPlatform(rendererPlatform)}
    >
      <ClientAuthBootstrap>
        <React.Suspense fallback={<AppLoadingFallback />}>
          <App />
        </React.Suspense>
      </ClientAuthBootstrap>
      <Toaster />
    </ThemeProvider>
  )
}

async function startRenderer() {
  await setupI18nLazy([LanguageDetector, initReactI18next])
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RootErrorBoundary>
        <JotaiProvider>
          <Root />
        </JotaiProvider>
      </RootErrorBoundary>
    </React.StrictMode>
  )

  // Main-process monitoring is already active. Keep the renderer SDK off the startup
  // critical path; an early render crash still initializes it through RootErrorBoundary.
  window.setTimeout(() => void initializeRendererMonitoring(), 3_000)
}

void startRenderer()
