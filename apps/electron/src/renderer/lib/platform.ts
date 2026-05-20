/**
 * Platform Detection Utilities
 *
 * Centralized platform detection for the renderer process.
 * Use these instead of accessing navigator.platform directly.
 *
 * @example
 * import { isMac, isWindows, PATH_SEP, getPathBasename } from '@/lib/platform'
 *
 * // Platform checks
 * const modifier = isMac ? '⌘' : 'Ctrl'
 *
 * // Path handling
 * const folderName = getPathBasename('/Users/alice/projects') // 'projects'
 */

export type RendererPlatformName = 'darwin' | 'win32' | 'linux' | 'other'

export function getRendererPlatformName(platform?: string): RendererPlatformName {
  const normalized = (platform ?? '').toLowerCase()
  if (normalized.includes('mac')) return 'darwin'
  if (normalized.includes('win')) return 'win32'
  if (normalized.includes('linux')) return 'linux'
  return 'other'
}

export const rendererPlatform = getRendererPlatformName(
  typeof navigator !== 'undefined' ? navigator.platform : undefined,
)

/** True if running on macOS */
export const isMac = rendererPlatform === 'darwin'

/** True if running on Windows */
export const isWindows = rendererPlatform === 'win32'

/** True if running on Linux */
export const isLinux = rendererPlatform === 'linux'

/**
 * Resolve the app's first-run color theme for each platform.
 *
 * Windows' native frame/material rendering can make the purple-tinted default
 * feel inconsistent around the app chrome, so use a neutral preset there.
 * User-selected themes still take precedence in ThemeContext.
 */
export function getDefaultColorThemeForPlatform(platform: RendererPlatformName): string {
  return platform === 'win32' ? 'github' : 'default'
}

/**
 * Get the platform-specific file manager name.
 * macOS → "Finder", Windows → "Explorer", Linux → "File Manager"
 */
export function getFileManagerName(): string {
  if (isMac) return 'Finder'
  if (isWindows) return 'Explorer'
  return 'File Manager'
}

/** Native path separator for current OS */
export const PATH_SEP = isWindows ? '\\' : '/'

/**
 * Get the last segment of a path (folder/file name).
 * Handles both Unix (/) and Windows (\) separators based on current OS.
 */
export function getPathBasename(path: string): string {
  return path.split(PATH_SEP).pop() || ''
}
