// input: Electron preload API and renderer startup container
// output: React root that mounts the workspace app with one application-wide update controller
// pos: Renderer entrypoint for the desktop application

import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider, useAtomValue } from 'jotai'
import { ThemeProvider } from './context/ThemeContext'
import { windowWorkspaceIdAtom } from './atoms/sessions'
import { Toaster } from '@/components/ui/sonner'
import { UpdateCheckerProvider } from '@/hooks/useUpdateChecker'
import { setupI18nLazy } from '@craft-agent/shared/i18n/lazy'
import { initReactI18next } from 'react-i18next'
import { useTranslation } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { getDefaultColorThemeForPlatform, rendererPlatform } from '@/lib/platform'
import './index.css'

const App = React.lazy(() => import('./App'))

document.documentElement.dataset.platform = rendererPlatform

/**
 * Minimal fallback UI shown when the entire React tree crashes.
 */
function CrashFallback() {
  const { t } = useTranslation()

  return (
    <div
      data-testid="root-crash-fallback"
      className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3"
    >
      <p className="text-base font-medium">{t('errors.somethingWentWrong')}</p>
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
    console.error('[renderer] Root React tree crashed', error, info.componentStack)
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
      <UpdateCheckerProvider>
        <React.Suspense fallback={<AppLoadingFallback />}>
          <App />
        </React.Suspense>
        <Toaster />
      </UpdateCheckerProvider>
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
}

void startRenderer()
