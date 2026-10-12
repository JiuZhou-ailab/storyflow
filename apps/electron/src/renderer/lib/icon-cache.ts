// input: Entity icon metadata, workspace image IPC, native DOMParser, and cached icon assets
// output: Sanitized renderable source, skill, and status icons
// pos: Single renderer icon resolution and cache boundary

/**
 * Unified Icon Cache
 *
 * Single cache for source, skill, and status icons.
 * Used by EntityIcon, SourceAvatar, SkillAvatar, StatusIcon, and RichTextInput.
 *
 * Icons are stored as data URLs for consistent usage across:
 * - React components (img src)
 * - HTML string generation (inline badges)
 *
 * Cache key format uses type prefixes to avoid collisions:
 * - source:{workspaceId}:{slug}
 * - skill:{workspaceId}:{slug}
 * - status:{workspaceId}:{relativePath}
 *
 * Note: Labels do NOT use icons — they are color-only (colored circles).
 *
 * The useEntityIcon() hook is the single entry point for loading any entity's icon.
 * It handles cache lookup, IPC file loading, SVG theming, and emoji detection.
 */

import { useState, useEffect, useMemo } from 'react'
import { isEmoji } from '@craft-agent/shared/utils/icon-constants'
import type { ResolvedEntityIcon } from '@craft-agent/shared/icons'

// ============================================================================
// Types
// ============================================================================

interface SourceConfig {
  slug: string
  name: string
  type: string
  icon?: string  // Emoji or URL (local icon files are auto-discovered separately)
  provider?: string
  mcp?: {
    url?: string
  }
  api?: {
    baseUrl?: string
  }
}

interface SkillConfig {
  slug: string
  /** Host catalog discovery result; omitted when no local icon exists. */
  iconPath?: string
  metadata?: { icon?: string }
}

// ============================================================================
// Unified Cache
// ============================================================================

/**
 * Single unified cache for all icon types.
 * Key format: `{type}:{workspaceId}:{identifier}`
 * - source:wsId:slug
 * - skill:wsId:slug
 * - status:wsId:relativePath
 */
export const iconCache = new Map<string, string>()

/**
 * Cache for resolved logo URLs (from service URL resolution).
 * Kept separate because it caches URL resolution, not icon data,
 * and uses a different key format: `{serviceUrl}:{provider}`
 */
export const logoUrlCache = new Map<string, string | null>()

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear source icon caches only.
 */
export function clearSourceIconCaches(): void {
  for (const key of iconCache.keys()) {
    if (key.startsWith('source:')) iconCache.delete(key)
  }
  logoUrlCache.clear()
  // Also clear from colorable/rawSvg caches
  for (const key of colorableCache) {
    if (key.startsWith('source:')) colorableCache.delete(key)
  }
  for (const key of rawSvgCache.keys()) {
    if (key.startsWith('source:')) rawSvgCache.delete(key)
  }
}

// ============================================================================
// Source Icon Loading
// ============================================================================

// Special prefix for emoji icons in cache - callers check for this to render emoji
export const EMOJI_ICON_PREFIX = 'emoji:'

/**
 * Load a source icon into the cache.
 *
 * Resolution priority (config.icon is the source of truth):
 * 1. Emoji in config.icon → Return emoji marker for caller to render as text
 * 2. Local path in config.icon (./icon.svg) → Load from sources/{slug}/icon.svg
 * 3. URL in config.icon → Return URL directly for browser to load
 * 4. config.icon undefined → Auto-discover sources/{slug}/icon.{svg,png}
 * 5. Fallback → Resolve favicon from service URL
 *
 * Config takes precedence over auto-discovered local files. If config.icon is set
 * (emoji, local path, or URL), auto-discovery is skipped.
 *
 * @returns Promise resolving to icon URL, emoji marker (emoji:{emoji}), or null
 */
export async function loadSourceIcon(
  source: { config: SourceConfig; workspaceId: string },
): Promise<string | null> {
  const { config, workspaceId } = source
  const cacheKey = `${workspaceId}:${config.slug}`

  // Check cache first
  const cached = iconCache.get(`source:${cacheKey}`)
  if (cached) return cached

  const icon = config.icon

  // Priority 1: Emoji icon - return marker for caller to render as text
  if (icon && isEmoji(icon)) {
    const emojiMarker = `${EMOJI_ICON_PREFIX}${icon}`
    iconCache.set(`source:${cacheKey}`, emojiMarker)
    return emojiMarker
  }

  // Priority 2: Explicit local path in config.icon (e.g., "./icon.svg")
  if (icon?.startsWith('./')) {
    const iconFilename = icon.slice(2) // Remove './'
    const relativePath = `sources/${config.slug}/${iconFilename}`
    const loaded = await loadWorkspaceIcon(workspaceId, relativePath)
    if (loaded) {
      iconCache.set(`source:${cacheKey}`, loaded)
      return loaded
    }
  }

  // Priority 3: URL in config.icon - return URL directly
  // Config URL takes precedence over auto-discovered local files
  if (icon && (icon.startsWith('http://') || icon.startsWith('https://'))) {
    iconCache.set(`source:${cacheKey}`, icon)
    return icon
  }

  // Priority 4: Auto-discover local icon files (only when config.icon is undefined)
  // This preserves backward compatibility for sources without explicit config.icon
  if (!icon) {
    const localIconSvg = await loadWorkspaceIcon(workspaceId, `sources/${config.slug}/icon.svg`)
    if (localIconSvg) {
      iconCache.set(`source:${cacheKey}`, localIconSvg)
      return localIconSvg
    }

    const localIconPng = await loadWorkspaceIcon(workspaceId, `sources/${config.slug}/icon.png`)
    if (localIconPng) {
      iconCache.set(`source:${cacheKey}`, localIconPng)
      return localIconPng
    }
  }

  // Priority 5: Resolve favicon from service URL
  const serviceUrl = deriveServiceUrl(config)
  if (!serviceUrl) return null

  // Use slug for favicon resolution - it's more specific than generic provider names
  const provider = config.slug ?? config.provider
  const logoCacheKey = `${serviceUrl}:${provider ?? ''}`

  // Check logo URL cache
  const cachedLogoUrl = logoUrlCache.get(logoCacheKey)
  if (cachedLogoUrl !== undefined) {
    if (cachedLogoUrl) {
      iconCache.set(`source:${cacheKey}`, cachedLogoUrl)
    }
    return cachedLogoUrl
  }

  try {
    const logoUrl = await window.electronAPI.getLogoUrl(serviceUrl, provider)
    logoUrlCache.set(logoCacheKey, logoUrl)
    if (logoUrl) {
      iconCache.set(`source:${cacheKey}`, logoUrl)
    }
    return logoUrl
  } catch (error) {
    console.error(`[IconCache] Failed to resolve logo URL:`, error)
    logoUrlCache.set(logoCacheKey, null)
    return null
  }
}

/**
 * Helper to load a workspace image via IPC.
 * Handles SVG theming and returns data URL or null on failure.
 */
function getWorkspaceImagePathCandidates(relativePath: string): string[] {
  const statePathPattern = /^(sources|skills|statuses)\//
  return relativePath.startsWith('.craft-agent/')
    ? [relativePath, relativePath.slice('.craft-agent/'.length)]
    : statePathPattern.test(relativePath)
      ? [`.craft-agent/${relativePath}`, relativePath]
      : [relativePath]
}

async function loadWorkspaceIcon(workspaceId: string, relativePath: string): Promise<string | null> {
  for (const candidate of getWorkspaceImagePathCandidates(relativePath)) {
    try {
      const result = await window.electronAPI.readWorkspaceImage(workspaceId, candidate)
      // IPC returns null for missing files (silent fallback)
      if (!result) {
        continue
      }
      // For SVG, theme and convert to data URL
      // This injects foreground color since currentColor doesn't work in background-image
      if (candidate.endsWith('.svg')) {
        return svgToThemedDataUrl(result)
      }
      return result
    } catch {
      // Security errors or I/O failures still throw - handle them gracefully
    }
  }

  return null
}

/**
 * Get a source icon synchronously from cache.
 * Returns null if not cached (use loadSourceIcon to populate).
 */
export function getSourceIconSync(workspaceId: string, slug: string): string | null {
  const cacheKey = `${workspaceId}:${slug}`
  return iconCache.get(`source:${cacheKey}`) ?? null
}

// ============================================================================
// Skill Icon Loading
// ============================================================================

/**
 * Load a skill icon into the cache.
 *
 * Resolution priority (local paths are resolved by the host Skill catalog):
 * 1. Emoji in metadata.icon → Return emoji marker
 * 2. URL in metadata.icon → Return URL directly
 * 3. Known iconPath → Load from file
 * 4. No catalog iconPath → Fallback (the host already discovered local icons)
 *
 * @returns Promise resolving to icon URL, emoji marker, or null
 */
export async function loadSkillIcon(
  skill: SkillConfig,
  workspaceId: string,
): Promise<string | null> {
  const cacheKey = `${workspaceId}:${skill.slug}`

  // Check cache first
  const cached = iconCache.get(`skill:${cacheKey}`)
  if (cached) return cached

  const iconValue = skill.metadata?.icon

  // Priority 1: Emoji icon - return marker for caller to render as text
  if (iconValue && isEmoji(iconValue)) {
    const emojiMarker = `${EMOJI_ICON_PREFIX}${iconValue}`
    iconCache.set(`skill:${cacheKey}`, emojiMarker)
    return emojiMarker
  }

  // Priority 2: URL in metadata - return URL directly
  if (iconValue && (iconValue.startsWith('http://') || iconValue.startsWith('https://'))) {
    iconCache.set(`skill:${cacheKey}`, iconValue)
    return iconValue
  }

  // Priority 3: Known icon path - load file
  if (skill.iconPath) {
    const skillsMatch = skill.iconPath.match(/skills\/([^/]+)\/(.+)$/)
    if (skillsMatch) {
      const relativePath = `skills/${skillsMatch[1]}/${skillsMatch[2]}`
      const loaded = await loadWorkspaceIcon(workspaceId, relativePath)
      if (loaded) {
        iconCache.set(`skill:${cacheKey}`, loaded)
        return loaded
      }
    }
  }

  // The loaded Skill catalog already resolves iconPath. A missing path means
  // no local icon; probing workspace-relative guesses repeats that work and
  // cannot discover icons belonging to user/plugin Skills outside the workspace.
  return null
}

/**
 * Get a skill icon synchronously from cache.
 * Returns null if not cached (use loadSkillIcon to populate).
 */
export function getSkillIconSync(workspaceId: string, slug: string): string | null {
  const cacheKey = `${workspaceId}:${slug}`
  return iconCache.get(`skill:${cacheKey}`) ?? null
}

// ============================================================================
// SVG Theming
// ============================================================================

/**
 * Get the current foreground color from CSS custom properties.
 * Returns the computed value of --foreground or a fallback.
 */
export function getForegroundColor(): string {
  if (typeof document === 'undefined') {
    // SSR/Node fallback - dark theme default
    return '#e3e2e5'
  }

  const computedColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--foreground')
    .trim()

  // If we got an oklch value, return it as-is (browsers handle it)
  // If empty, return a sensible default
  return computedColor || '#e3e2e5'
}

/**
 * Process SVG content to inject theme foreground color.
 *
 * This fixes SVGs that use currentColor or have no fill specified,
 * which would otherwise render as black when used as background-image
 * (since CSS color inheritance doesn't work for background images).
 *
 * @param svgContent - Raw SVG string content
 * @param foregroundColor - Color to inject (defaults to current theme foreground)
 * @returns Processed SVG string with colors injected
 */
export function themeSvgContent(
  svgContent: string,
  foregroundColor?: string
): string {
  const color = foregroundColor ?? getForegroundColor()

  let processed = svgContent

  // Replace all currentColor references with the actual color
  processed = processed.replace(/currentColor/gi, color)

  // For SVGs with no fill attribute on the root element, add one
  // This catches SVGs that rely on default black fill
  processed = processed.replace(
    /<svg([^>]*)>/i,
    (match, attrs) => {
      // Don't add fill if already has fill attribute (even fill="none")
      if (/\bfill\s*=/i.test(attrs)) {
        return match
      }
      // Add fill attribute to SVG root
      return `<svg${attrs} fill="${color}">`
    }
  )

  return processed
}

/**
 * Convert SVG content to a themed data URL.
 * Injects foreground color and encodes as base64.
 */
export function svgToThemedDataUrl(svgContent: string, foregroundColor?: string): string {
  const themedSvg = themeSvgContent(svgContent, foregroundColor)
  return `data:image/svg+xml;base64,${btoa(themedSvg)}`
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive service URL from source config (for favicon resolution)
 */
function deriveServiceUrl(config: SourceConfig): string | null {
  // MCP sources - use mcp.url
  if (config.type === 'mcp' && config.mcp?.url) {
    return config.mcp.url
  }

  // API sources - use api.baseUrl
  if (config.type === 'api' && config.api?.baseUrl) {
    return config.api.baseUrl
  }

  return null
}

// ============================================================================
// Unified Entity Icon Hook
// ============================================================================

/** Supported icon file extensions for auto-discovery */
const ICON_FILE_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg']

/**
 * Pre-compiled regex for extracting workspace-relative icon paths from absolute paths.
 * Matches any known entity directory prefix (skills/, sources/, statuses/)
 * followed by the rest of the path.
 */
const ICON_PATH_PATTERN = /(?:skills|sources|statuses)\/.+$/

/**
 * Options for the useEntityIcon hook.
 */
export interface UseEntityIconOptions {
  /** Workspace context for IPC calls */
  workspaceId: string
  /** Cache namespace (e.g. 'source', 'skill', 'status', 'label') */
  entityType: string
  /** Unique identifier within the entity type (slug, statusId, etc.) */
  identifier: string
  /**
   * Known relative path to icon file (for entities with pre-resolved paths).
   * e.g. 'skills/my-skill/icon.svg'
   * If provided, only this exact path is attempted (no auto-discovery).
   */
  iconPath?: string
  /**
   * Directory to auto-discover icon files in (relative to workspace).
   * e.g. 'sources/linear' → tries sources/linear/icon.svg, icon.png, etc.
   * Ignored if iconPath is provided.
   */
  iconDir?: string
  /**
   * Icon value from entity config. Can be:
   * - Emoji string (e.g. "🔧") → resolved as emoji
   * - URL (ignored here, assumed already downloaded to local file)
   * - undefined → auto-discover from iconDir
   */
  iconValue?: string
  /**
   * Override the filename used for auto-discovery (default: 'icon').
   * e.g. for statuses, set to the statusId so it discovers '{statusId}.svg'
   * instead of 'icon.svg'.
   */
  iconFileName?: string
}

/**
 * Unified icon loading hook - single entry point for all entity types.
 *
 * Handles cache lookup, IPC file loading, SVG theming, colorability detection,
 * and emoji detection. Returns a ResolvedEntityIcon ready for EntityIcon rendering.
 *
 * Resolution priority (config iconValue is the source of truth):
 * 1. Emoji in iconValue → { kind: 'emoji', value: emoji, colorable: false }
 * 2. URL in iconValue → { kind: 'file', value: url, colorable: false }
 * 3. Local file (iconPath) → { kind: 'file', value: dataUrl, colorable }
 * 4. Auto-discover in iconDir (only when iconValue is undefined) → { kind: 'file', value: dataUrl, colorable }
 * 5. Fallback → { kind: 'fallback', colorable: false }
 *
 * Config takes precedence over auto-discovered local files.
 *
 * Usage:
 *   const icon = useEntityIcon({ workspaceId, entityType: 'skill', identifier: slug, iconPath })
 *   return <EntityIcon icon={icon} fallbackIcon={Zap} />
 */
export function useEntityIcon(opts: UseEntityIconOptions): ResolvedEntityIcon {
  const { workspaceId, entityType, identifier, iconPath, iconDir, iconValue, iconFileName } = opts

  // Stable cache key for this entity's icon
  const cacheKey = `${entityType}:${workspaceId}:${identifier}`

  // Check if iconValue is an emoji or URL (synchronous, no loading needed)
  const immediateValue = useMemo(() => {
    // Guard against non-string values (can happen with malformed config data)
    if (!iconValue || typeof iconValue !== 'string') return null
    if (isEmoji(iconValue)) return { type: 'emoji' as const, value: iconValue }
    if (iconValue.startsWith('http://') || iconValue.startsWith('https://')) {
      return { type: 'url' as const, value: iconValue }
    }
    return null
  }, [iconValue])

  // Initial state: check cache synchronously or return emoji/url/fallback
  const [resolved, setResolved] = useState<ResolvedEntityIcon>(() => {
    if (immediateValue?.type === 'emoji') {
      return { kind: 'emoji', value: immediateValue.value, colorable: false }
    }
    if (immediateValue?.type === 'url') {
      // URLs are returned directly as 'file' kind (works in img src)
      return { kind: 'file', value: immediateValue.value, colorable: false }
    }
    // Check unified cache for a previously loaded file icon
    const cached = iconCache.get(cacheKey)
    if (cached) {
      const colorable = colorableCache.has(cacheKey)
      return {
        kind: 'file',
        value: cached,
        colorable,
        rawSvg: colorable ? rawSvgCache.get(cacheKey) : undefined,
      }
    }
    return { kind: 'fallback', colorable: false }
  })

  useEffect(() => {
    // If emoji, no file loading needed - just update state
    if (immediateValue?.type === 'emoji') {
      // This state reconciles cached/IPC icon data when the external icon identity changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResolved({ kind: 'emoji', value: immediateValue.value, colorable: false })
      return
    }

    // If URL from config, use it directly (no file loading needed)
    // Config URL takes precedence over auto-discovered local files
    if (immediateValue?.type === 'url') {
      setResolved({ kind: 'file', value: immediateValue.value, colorable: false })
      return
    }

    // Check cache first
    const cached = iconCache.get(cacheKey)
    if (cached) {
      const colorable = colorableCache.has(cacheKey)
      setResolved({
        kind: 'file',
        value: cached,
        colorable,
        rawSvg: colorable ? rawSvgCache.get(cacheKey) : undefined,
      })
      return
    }

    // No cache hit - load from filesystem via IPC
    let cancelled = false

    async function loadIcon() {
      let result: { dataUrl: string; colorable: boolean; rawSvg?: string } | null = null

      if (iconPath) {
        // Known path - extract relative portion and load directly
        // iconPath may be absolute; extract the workspace-relative part
        const relativeMatch = iconPath.match(ICON_PATH_PATTERN)
        const relativePath = relativeMatch ? relativeMatch[0] : iconPath

        result = await loadIconFile(workspaceId, relativePath)
      } else if (iconDir && !iconValue) {
        // Auto-discover icon files in directory
        // Only do auto-discovery when iconValue is undefined (config takes precedence)
        // iconFileName overrides the default 'icon' prefix (e.g. statuses use statusId)
        result = await discoverIconFile(workspaceId, iconDir, iconFileName)
      }

      if (cancelled) return

      if (result) {
        // Cache the loaded icon and its colorability/rawSvg
        iconCache.set(cacheKey, result.dataUrl)
        if (result.colorable) {
          colorableCache.add(cacheKey)
        }
        if (result.rawSvg) {
          rawSvgCache.set(cacheKey, result.rawSvg)
        }
        setResolved({
          kind: 'file',
          value: result.dataUrl,
          colorable: result.colorable,
          rawSvg: result.rawSvg,
        })
      } else {
        setResolved({ kind: 'fallback', colorable: false })
      }
    }

    loadIcon()

    return () => { cancelled = true }
  }, [workspaceId, entityType, identifier, iconPath, iconDir, iconFileName, immediateValue, cacheKey, iconValue])

  return resolved
}

// ============================================================================
// useEntityIcon Internal Helpers
// ============================================================================

/**
 * Tracks which cached icons are colorable (use currentColor).
 * Kept as a Set of cache keys for O(1) lookup.
 */
const colorableCache = new Set<string>()

/**
 * Stores sanitized raw SVG content for colorable icons.
 * Used for inline rendering so CSS color classes can cascade into SVG fills.
 */
const rawSvgCache = new Map<string, string>()

/**
 * Load a single icon file by relative path.
 * Handles SVG theming, colorability detection, and sanitization.
 *
 * For colorable SVGs (those using currentColor), returns rawSvg for inline rendering
 * so CSS color classes can cascade into SVG fills/strokes.
 */
async function loadIconFile(
  workspaceId: string,
  relativePath: string
): Promise<{ dataUrl: string; colorable: boolean; rawSvg?: string } | null> {
  for (const candidate of getWorkspaceImagePathCandidates(relativePath)) {
    try {
      const content = await window.electronAPI.readWorkspaceImage(workspaceId, candidate)
      // IPC returns null for missing files (silent fallback)
      if (!content) {
        continue
      }

      if (candidate.endsWith('.svg')) {
        // Detect if SVG uses currentColor (colorable)
        const colorable = content.includes('currentColor')
        // Theme SVG: inject foreground color for data URL usage
        const dataUrl = svgToThemedDataUrl(content)

        if (colorable) {
          // Sanitize SVG for inline rendering (XSS prevention)
          const rawSvg = sanitizeSvgForInline(content)
          return { dataUrl, colorable, rawSvg }
        }

        return { dataUrl, colorable }
      }

      // Raster image (PNG, JPG) - not colorable
      return { dataUrl: content, colorable: false }
    } catch {
      // File doesn't exist or failed to load
    }
  }
  return null
}

/** DOM allowlist for SVG inserted into the renderer via dangerouslySetInnerHTML. */
export function sanitizeSvgForInline(svg: string): string {
  const namespace = 'http://www.w3.org/2000/svg'
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = parsed.documentElement
  if (parsed.doctype || parsed.querySelector('parsererror') || root.localName !== 'svg'
    || (root.namespaceURI !== null && root.namespaceURI !== namespace)) return ''

  const elements = new Set([
    'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse',
    'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop',
    'clipPath', 'mask', 'title', 'desc', 'text', 'tspan',
  ])
  const attributes = new Set([
    'id', 'viewBox', 'preserveAspectRatio', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
    'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'fill', 'fill-rule',
    'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
    'opacity', 'clip-path', 'clip-rule', 'mask', 'gradientUnits', 'gradientTransform',
    'spreadMethod', 'offset', 'stop-color', 'stop-opacity', 'fx', 'fy', 'fr',
    'clipPathUnits', 'maskUnits', 'maskContentUnits', 'text-anchor', 'dominant-baseline',
    'font-size', 'font-weight', 'dx', 'dy', 'role', 'aria-label', 'aria-hidden',
  ])
  const paint = new Set(['fill', 'stroke', 'stop-color'])
  const localUrl = /^url\(#[\w:.-]+\)$/
  const clean = parsed.implementation.createDocument(namespace, 'svg')
  const pending: Array<[Element, Element]> = [[root, clean.documentElement]]
  while (pending.length) {
    const [source, target] = pending.pop()!
    for (const attribute of Array.from(source.attributes)) {
      const { name, localName, namespaceURI, value } = attribute
      if (localName === 'href' && (!namespaceURI || namespaceURI === 'http://www.w3.org/1999/xlink')) {
        if (/^#[\w:.-]+$/.test(value)) target.setAttribute('href', value)
        continue
      }
      if (namespaceURI || !attributes.has(name) || /^on/i.test(name)) continue
      // Only simple colors and local paint servers; CSS escapes and external URLs are excluded.
      if (paint.has(name) && !/^(?:[a-zA-Z]+|#[\da-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.,% +\-]+\))$/.test(value)
        && !localUrl.test(value)) continue
      if ((name === 'clip-path' || name === 'mask') && value !== 'none' && !localUrl.test(value)) continue
      target.setAttribute(name, value)
    }
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === 1) {
        const element = child as Element
        if (!elements.has(element.localName) || (element.namespaceURI !== null && element.namespaceURI !== namespace)) continue
        const copy = clean.createElementNS(namespace, element.localName)
        target.appendChild(copy)
        pending.push([element, copy])
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        target.appendChild(clean.createTextNode(child.textContent ?? ''))
      }
    }
  }
  return new XMLSerializer().serializeToString(clean.documentElement)
}

/**
 * Auto-discover an icon file in a workspace directory.
 * Probes all extensions (.svg, .png, .jpg, .jpeg) in parallel via IPC,
 * then returns the first successful result by priority order.
 * Default fileName is 'icon' (e.g. icon.svg). Override for entities
 * that use identifier-based naming (e.g. statuses use '{statusId}.svg').
 */
async function discoverIconFile(
  workspaceId: string,
  iconDir: string,
  fileName?: string
): Promise<{ dataUrl: string; colorable: boolean; rawSvg?: string } | null> {
  const name = fileName ?? 'icon'

  // Probe all extensions in parallel — reduces round-trips from N to 1
  const results = await Promise.allSettled(
    ICON_FILE_EXTENSIONS.map(ext =>
      loadIconFile(workspaceId, `${iconDir}/${name}${ext}`)
    )
  )

  // Return first successful result in priority order (svg > png > jpg > jpeg)
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) return result.value
  }
  return null
}
