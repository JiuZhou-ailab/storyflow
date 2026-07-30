// input: Renderer thumbnail/media URLs and configured local project roots
// output: Bounded thumbnails plus project-authorized native file streams
// pos: Main-process protocol boundary for local visual assets
/**
 * Local File Protocol Handlers
 *
 * Registers a custom `thumbnail://` protocol that serves thumbnail images
 * and a `workspace-file://` protocol that streams project media without
 * copying file bytes through IPC, WebSocket, or renderer JavaScript.
 *
 * Thumbnail generation strategy (cross-platform):
 * - macOS/Windows: nativeImage.createThumbnailFromPath() — uses OS-level
 *   thumbnail cache (Quick Look / Shell API). Fast (~5ms cached), handles
 *   images, PDFs, Office docs automatically.
 * - Linux: nativeImage.createFromPath() + resize() — uses Chromium's Skia
 *   engine. Works for images only. No PDF/Office support.
 *
 * Caching:
 * - In-memory LRU map keyed on `path + mtime`. Cache miss triggers generation.
 * - Entries auto-invalidate when file mtime changes (e.g. after file watcher fires).
 * - Capped at MAX_CACHE_ENTRIES to bound memory usage.
 */

import { protocol, nativeImage } from 'electron'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import { Readable } from 'stream'
import { loadStoredConfig } from '@craft-agent/shared/config'
import { isPathWithinProjectRoot } from '@craft-agent/shared/workspaces'
import { mainLog } from './logger'

/** Thumbnail output size in pixels (width and height) */
const THUMBNAIL_SIZE = 64

/** Maximum entries in the in-memory LRU cache */
const MAX_CACHE_ENTRIES = 200

/** File extensions that support thumbnail generation */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif',
])

/** Extensions that only work via OS thumbnail API (macOS/Windows) */
const OS_THUMBNAIL_EXTENSIONS = new Set([
  'pdf', 'svg', 'psd', 'ai',
])

/** All extensions we can potentially thumbnail */
const ALL_PREVIEWABLE = new Set([...IMAGE_EXTENSIONS, ...OS_THUMBNAIL_EXTENSIONS])

/** Media formats Chromium can decode directly in the shared project tab. */
const WORKSPACE_MEDIA_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
  'mp4', 'webm', 'm4v', 'mov',
])

const WORKSPACE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
}

// ponytail: one-second config cache avoids synchronous JSON reads per Range request;
// replace with config-change invalidation if storage exposes a process-wide change feed.
let workspaceRootCache = { expiresAt: 0, roots: [] as string[] }

// In-memory LRU cache: path -> { mtime, data }
const cache = new Map<string, { mtime: number; data: Buffer }>()

/**
 * Evict oldest entries when cache exceeds max size.
 * Map iterates in insertion order, so first entries are oldest.
 */
function evictIfNeeded(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
}

/**
 * Check if the current platform supports OS-level thumbnail generation.
 * nativeImage.createThumbnailFromPath() is only available on macOS and Windows.
 */
const supportsOSThumbnails = process.platform === 'darwin' || process.platform === 'win32'

/**
 * Generate a thumbnail buffer for the given file path.
 * Returns a PNG buffer or null if generation fails/unsupported.
 */
async function generateThumbnail(filePath: string, ext: string): Promise<Buffer | null> {
  // Strategy 1: OS-level thumbnail (macOS/Windows) — handles images + PDFs + more
  if (supportsOSThumbnails) {
    try {
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, {
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
      })
      if (!thumbnail.isEmpty()) {
        return thumbnail.toPNG()
      }
    } catch {
      // OS thumbnail failed — fall through to Skia-based fallback for images
    }
  }

  // Strategy 2: Skia-based resize (all platforms) — images only
  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const img = nativeImage.createFromPath(filePath)
      if (img.isEmpty()) return null
      const resized = img.resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE })
      return resized.toPNG()
    } catch {
      return null
    }
  }

  // Unsupported file type on this platform
  return null
}

/**
 * Register the thumbnail:// custom protocol scheme.
 * MUST be called before app.whenReady() — Electron requires scheme
 * registration during the earliest phase of app initialization.
 */
export function registerThumbnailScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'thumbnail',
      privileges: {
        // Allow the renderer to fetch from this scheme
        supportFetchAPI: true,
        // Standard scheme allows normal URL parsing (host, path, etc.)
        standard: true,
        // Allow cross-origin access from the renderer
        corsEnabled: true,
        // Stream support for efficient response delivery
        stream: true,
      },
    },
    {
      scheme: 'workspace-file',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

function isAuthorizedWorkspaceMediaPath(filePath: string): boolean {
  if (!isAbsolute(filePath)) return false

  const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (!WORKSPACE_MEDIA_EXTENSIONS.has(extension)) return false

  const now = Date.now()
  if (now >= workspaceRootCache.expiresAt) {
    workspaceRootCache = {
      expiresAt: now + 1_000,
      roots: loadStoredConfig()?.workspaces
        .filter((workspace) => !workspace.remoteServer)
        .map((workspace) => workspace.rootPath) ?? [],
    }
  }

  const target = resolve(filePath)
  const lexicalMatches = workspaceRootCache.roots.filter((rootPath) => {
    const pathFromRoot = relative(resolve(rootPath), target)
    return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
  })
  const candidateRoots = lexicalMatches.length > 0 ? lexicalMatches : workspaceRootCache.roots
  return candidateRoots.some((rootPath) => isPathWithinProjectRoot(rootPath, filePath))
}

function parseByteRange(value: string | null, size: number): { start: number; end: number } | null | undefined {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || size <= 0) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || start >= size
    || end < start
  ) {
    return null
  }
  return { start, end: Math.min(end, size - 1) }
}

/**
 * Register the thumbnail:// protocol handler.
 * Must be called after app.whenReady() — the handler processes
 * incoming requests and returns thumbnail image responses.
 *
 * URL format: thumbnail://thumb/<encodeURIComponent(absolutePath)>
 * Examples:
 *   macOS:   thumbnail://thumb/%2FUsers%2Ffoo%2Fimage.png
 *   Windows: thumbnail://thumb/C%3A%5CUsers%5Cfoo%5Cimage.png
 */
export function registerThumbnailHandler(): void {
  protocol.handle('thumbnail', async (request) => {
    try {
      // Parse the file path from the URL
      // Format: thumbnail://thumb/<encoded-path>
      // URL.pathname includes a leading /, so we strip it before decoding
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname.slice(1))

      // Basic validation: must be an absolute path (works on all platforms)
      if (!filePath || !isAbsolute(filePath)) {
        return new Response(null, { status: 400 })
      }

      // Check file extension is previewable
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      if (!ALL_PREVIEWABLE.has(ext)) {
        return new Response(null, { status: 404 })
      }

      // Get file mtime for cache validation
      let mtime: number
      try {
        const fileStat = await stat(filePath)
        mtime = fileStat.mtimeMs
      } catch {
        // File doesn't exist or is inaccessible
        return new Response(null, { status: 404 })
      }

      // Check cache — hit if path matches AND mtime hasn't changed
      const cached = cache.get(filePath)
      if (cached && cached.mtime === mtime) {
        return new Response(new Uint8Array(cached.data), {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'max-age=3600',
          },
        })
      }

      // Cache miss — generate thumbnail
      const data = await generateThumbnail(filePath, ext)
      if (!data) {
        return new Response(null, { status: 404 })
      }

      // Store in cache (move to end for LRU behavior by delete+set)
      cache.delete(filePath)
      cache.set(filePath, { mtime, data })
      evictIfNeeded()

      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'max-age=3600',
        },
      })
    } catch (error) {
      mainLog.error('Thumbnail protocol error:', error)
      return new Response(null, { status: 500 })
    }
  })

  protocol.handle('workspace-file', async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname.slice(1))
      if (url.host !== 'media' || !isAuthorizedWorkspaceMediaPath(filePath)) {
        return new Response(null, { status: 403 })
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405 })
      }

      const fileStats = await stat(filePath)
      if (!fileStats.isFile()) return new Response(null, { status: 404 })

      const range = parseByteRange(request.headers.get('range'), fileStats.size)
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': WORKSPACE_MEDIA_TYPES[filePath.split('.').pop()?.toLowerCase() ?? '']
          ?? 'application/octet-stream',
        'Last-Modified': fileStats.mtime.toUTCString(),
      })
      if (range === null) {
        headers.set('Content-Range', `bytes */${fileStats.size}`)
        return new Response(null, { status: 416, headers })
      }

      const start = range?.start ?? 0
      const end = range?.end ?? Math.max(0, fileStats.size - 1)
      headers.set('Content-Length', String(fileStats.size === 0 ? 0 : end - start + 1))
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${fileStats.size}`)

      const body = request.method === 'HEAD' || fileStats.size === 0
        ? null
        : Readable.toWeb(createReadStream(filePath, { start, end }))
      return new Response(body as BodyInit | null, {
        status: range ? 206 : 200,
        headers,
      })
    } catch (error) {
      mainLog.error('Workspace file protocol error:', error)
      return new Response(null, { status: 500 })
    }
  })

  mainLog.info('Registered thumbnail:// and workspace-file:// protocol handlers')
}
