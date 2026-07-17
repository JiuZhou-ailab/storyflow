// input: Project shell props and the active syntax-highlighting theme
// output: Lazily loaded writing workspace with its editor-specific providers
// pos: Product-surface boundary that keeps AppShell and Shiki out of ProjectHub startup

import type { ComponentProps } from 'react'
import { ShikiThemeProvider } from '@craft-agent/ui/context'
import { AppShell } from '@/components/app-shell/AppShell'

interface WorkspaceSurfaceProps extends ComponentProps<typeof AppShell> {
  shikiTheme: string | null
}

export function WorkspaceSurface({ shikiTheme, ...appShellProps }: WorkspaceSurfaceProps) {
  return (
    <ShikiThemeProvider shikiTheme={shikiTheme}>
      <AppShell {...appShellProps} />
    </ShikiThemeProvider>
  )
}
