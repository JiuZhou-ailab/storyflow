// input: EditPopover source and AppShell action context source
// output: Regression coverage for edit popover action subscription boundaries
// pos: Keeps compact edit sessions off broad app shell context updates

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const editPopoverSource = readFileSync(new URL('../EditPopover.tsx', import.meta.url), 'utf-8')
const appShellContextSource = readFileSync(new URL('../../../context/AppShellContext.tsx', import.meta.url), 'utf-8')
const escapeInterruptContextSource = readFileSync(new URL('../../../context/EscapeInterruptContext.tsx', import.meta.url), 'utf-8')

describe('EditPopover subscriptions', () => {
  it('uses a narrow session interaction action context', () => {
    expect(editPopoverSource).not.toContain('useAppShellContext')
    expect(editPopoverSource).not.toContain('useActiveWorkspace')
    expect(editPopoverSource).toContain('workspacePanelFieldsAtomFamily')
    expect(editPopoverSource).toContain('windowWorkspaceIdAtom')
    expect(editPopoverSource).toContain('useSessionInteractionActions')
    expect(editPopoverSource).toContain('useSession(')
    expect(editPopoverSource).toContain('usePendingPermission')
    expect(editPopoverSource).toContain('usePendingCredential')
    expect(appShellContextSource).toContain('SessionInteractionActionsContext')
  })

  it('uses escape interrupt actions without subscribing to overlay state', () => {
    expect(editPopoverSource).toContain('useEscapeInterruptActions')
    expect(editPopoverSource).not.toContain('useEscapeInterrupt()')
    expect(escapeInterruptContextSource).toContain('const EscapeInterruptActionsContext = createContext<EscapeInterruptActionsContextType | null>(null)')
    expect(escapeInterruptContextSource).toContain('const showEscapeOverlayRef = useRef(showEscapeOverlay)')
    expect(escapeInterruptContextSource).toContain('if (showEscapeOverlayRef.current)')
  })
})
