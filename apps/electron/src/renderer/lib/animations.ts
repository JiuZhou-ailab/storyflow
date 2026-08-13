/**
 * Shared animation configurations for synchronized animations across components
 */

// Easing curves for fullscreen overlay animations
// Entry: exponential out - fast start, smooth deceleration (responsive feel)
export const overlayEaseIn = [0.16, 1, 0.3, 1] as const  // expo-out

// Tween config for entry animation
export const overlayTransitionIn = {
  duration: 0.4,
  ease: overlayEaseIn,
}
