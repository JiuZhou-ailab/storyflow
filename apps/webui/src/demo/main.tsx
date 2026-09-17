// input: Installed demo ElectronAPI and the shared renderer
// output: Real Storyflow workbench in the demo iframe
// pos: Browser composition of existing application providers
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useAtomValue } from 'jotai'
import App from '@/App'
import { ThemeProvider } from '@/context/ThemeContext'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { Toaster } from '@/components/ui/sonner'
import { UpdateCheckerProvider } from '@/hooks/useUpdateChecker'
import { setupI18n } from '@craft-agent/shared/i18n'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import '../index.css'
import './styles.css'

setupI18n([LanguageDetector, initReactI18next])
function Root() {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  return <ThemeProvider activeWorkspaceId={workspaceId}><UpdateCheckerProvider><App /><Toaster /></UpdateCheckerProvider></ThemeProvider>
}
class DemoBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    console.error(error)
    window.parent.postMessage({ type: 'storyflow-demo-error' }, location.origin)
  }
  render() {
    return this.state.failed ? <p role="alert">示例项目加载失败。<button onClick={() => location.reload()}>重新打开</button></p> : this.props.children
  }
}
createRoot(document.getElementById('root')!).render(<DemoBoundary><Provider><Root /></Provider></DemoBoundary>)
