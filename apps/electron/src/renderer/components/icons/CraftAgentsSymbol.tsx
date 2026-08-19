import storyflowLogo from '@/assets/storyflow-logo.png'
import { cn } from '@/lib/utils'

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Storyflow mark used by the desktop splash, auth, and onboarding surfaces.
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return <img src={storyflowLogo} alt="" aria-hidden="true" className={cn(className, 'aspect-square rounded-[25%] object-cover')} />
}
