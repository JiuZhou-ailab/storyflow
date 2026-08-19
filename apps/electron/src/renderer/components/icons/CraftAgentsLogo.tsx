import storyflowLogo from '@/assets/storyflow-logo.png'
import { cn } from '@/lib/utils'

interface CraftAgentsLogoProps {
  className?: string
}

/**
 * Storyflow logo used by the design-system playground.
 */
export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return <img src={storyflowLogo} alt="Storyflow" className={cn(className, 'aspect-square rounded-[25%] object-cover')} />
}
