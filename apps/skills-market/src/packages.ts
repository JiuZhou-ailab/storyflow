// input: Untrusted single-Skill ResourceBundle JSON and digest-pinned curated ZIP archives
// output: Strict package validation plus deterministic ResourceBundles for approved upstream Skills
// pos: Portable publication and curated-package trust boundary

import type { ResourceBundle } from '@craft-agent/shared/resources'
import {
  STORYFLOW_SKILL_MANIFEST_FILE,
  type StoryflowSkillManifest,
  validateStoryflowSkillManifest,
  sha256Hex,
} from '@craft-agent/shared/skills/marketplace'
import { validateSkillContent } from '@craft-agent/session-tools-core/skill-validation'
import { portablePathCollisionKey, validatePortableFilePath } from '@craft-agent/shared/resources/portable-path'
import { unzipSync } from 'fflate'
import type { CuratedSkill } from './catalog.ts'

const MAX_PACKAGE_BYTES = 5 * 1024 * 1024
const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES = 128
const ALLOWED_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv'])
const ALLOWED_TEXT_FILENAMES = new Set(['LICENSE', 'NOTICE', 'bun.lock'])
const CURATED_SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.ps1'])

interface MarketBundleValidationOptions {
  allowPinnedHiddenPaths?: boolean
  allowPinnedScripts?: boolean
}

export interface ValidatedMarketBundle {
  bundle: ResourceBundle
  raw: string
  bytes: number
  sha256: string
  manifest: StoryflowSkillManifest
  skillMarkdown: string
  files: ReadonlyMap<string, string>
}

export async function readCuratedArchive(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_PACKAGE_BYTES) {
    throw new Error('Curated Skill archive exceeds 5 MB')
  }

  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_PACKAGE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error('Curated Skill archive exceeds 5 MB')
    }
    chunks.push(value)
  }

  const archive = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    archive.set(chunk, offset)
    offset += chunk.byteLength
  }
  return archive
}

export async function validateMarketBundle(
  value: string | unknown,
  options: MarketBundleValidationOptions = {},
): Promise<ValidatedMarketBundle> {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  const bytes = new TextEncoder().encode(raw).byteLength
  if (bytes > MAX_PACKAGE_BYTES) throw new Error('Skill package exceeds 5 MB')

  const bundle = (typeof value === 'string' ? JSON.parse(raw) : value) as ResourceBundle
  const resources = bundle?.resources
  const skills = resources?.skills
  if (bundle?.version !== 1 || !Array.isArray(skills) || skills.length !== 1) {
    throw new Error('A market package must be a ResourceBundle containing exactly one Skill')
  }
  if (resources.sources || resources.automations) throw new Error('Market packages cannot contain Sources or Automations')
  const skill = skills[0]!
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.slug) || skill.slug.length > 64) {
    throw new Error('Invalid Skill slug')
  }
  if (!Array.isArray(skill.files) || skill.files.length === 0 || skill.files.length > MAX_FILES) {
    throw new Error(`A market Skill must contain 1-${MAX_FILES} files`)
  }

  const decoded = new Map<string, string>()
  const pathKeys = new Set<string>()
  let totalDecodedBytes = 0
  for (const file of skill.files) {
    if (!file || typeof file.relativePath !== 'string' || !isSafePackagePath(
      file.relativePath,
      options.allowPinnedHiddenPaths,
    )) {
      throw new Error('Skill package contains an unsafe path')
    }
    const collisionKey = portablePathCollisionKey(file.relativePath)
    if (pathKeys.has(collisionKey)) throw new Error(`Duplicate package path: ${file.relativePath}`)
    pathKeys.add(collisionKey)
    if (!isAllowedTextPath(file.relativePath, options.allowPinnedScripts)) {
      throw new Error(`Unsupported executable or binary path: ${file.relativePath}`)
    }
    if (typeof file.contentBase64 !== 'string' || typeof file.size !== 'number' || file.size < 0 || file.size > MAX_FILE_BYTES) {
      throw new Error(`Invalid file metadata: ${file.relativePath}`)
    }
    const content = decodeUtf8Base64(file.contentBase64)
    const actualBytes = new TextEncoder().encode(content).byteLength
    if (actualBytes !== file.size) throw new Error(`File size mismatch: ${file.relativePath}`)
    totalDecodedBytes += actualBytes
    if (totalDecodedBytes > MAX_PACKAGE_BYTES) throw new Error('Expanded Skill package exceeds 5 MB')
    decoded.set(file.relativePath, content)
  }

  const skillMarkdown = decoded.get('SKILL.md')
  if (!skillMarkdown) throw new Error('SKILL.md is required')
  const skillValidation = validateSkillContent(skillMarkdown, skill.slug)
  if (!skillValidation.valid) {
    throw new Error(`Invalid SKILL.md: ${skillValidation.errors.map(issue => issue.message).join('; ')}`)
  }

  const manifestText = decoded.get(STORYFLOW_SKILL_MANIFEST_FILE)
  if (!manifestText) throw new Error(`${STORYFLOW_SKILL_MANIFEST_FILE} is required`)
  const manifest = JSON.parse(manifestText) as StoryflowSkillManifest
  const manifestErrors = validateStoryflowSkillManifest(manifest)
  if (manifestErrors.length > 0) throw new Error(`Invalid ${STORYFLOW_SKILL_MANIFEST_FILE}: ${manifestErrors.join('; ')}`)
  if (manifest.slug !== skill.slug) throw new Error('Manifest slug must match the bundle Skill slug')

  return {
    bundle,
    raw,
    bytes,
    sha256: await sha256Hex(raw),
    manifest,
    skillMarkdown,
    files: decoded,
  }
}

export async function convertCuratedSkillArchive(
  seed: CuratedSkill,
  archive: Uint8Array,
): Promise<ValidatedMarketBundle> {
  const packageMetadata = seed.package
  if (!packageMetadata) throw new Error('Curated Skill has no installable package')
  if (archive.byteLength > MAX_PACKAGE_BYTES) throw new Error('Curated Skill archive exceeds 5 MB')
  if (await sha256Hex(archive) !== packageMetadata.archiveSha256) {
    throw new Error('Curated Skill archive checksum does not match the catalog')
  }
  const manifest = packageMetadata.manifest
  if (manifest.slug !== seed.slug || manifest.version !== packageMetadata.version) {
    throw new Error('Curated package manifest identity does not match its catalog coordinates')
  }
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`
  let fileCount = 0
  let expandedBytes = 0
  const entries = Object.entries(unzipSync(archive, { filter: file => {
    if (file.name.endsWith('/') || file.name === STORYFLOW_SKILL_MANIFEST_FILE) return false
    fileCount += 1
    expandedBytes += file.originalSize
    if (fileCount >= MAX_FILES) throw new Error(`Curated Skill archive exceeds ${MAX_FILES - 1} files`)
    if (file.originalSize > MAX_FILE_BYTES) throw new Error(`Curated Skill archive file exceeds ${MAX_FILE_BYTES} bytes`)
    if (expandedBytes > MAX_PACKAGE_BYTES) throw new Error('Expanded Skill package exceeds 5 MB')
    return true
  } }))
    .map(([relativePath, content]) => bundleFile(relativePath, content))
  entries.push(bundleFile(STORYFLOW_SKILL_MANIFEST_FILE, new TextEncoder().encode(manifestContent)))
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))

  const bundle: ResourceBundle = {
    version: 1,
    exportedAt: packageMetadata.publishedAt,
    resources: { skills: [{ slug: seed.slug, files: entries }] },
  }
  return validateMarketBundle(bundle, {
    allowPinnedHiddenPaths: true,
    allowPinnedScripts: true,
  })
}

function decodeUtf8Base64(value: string): string {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('Invalid base64 content')
  }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Market packages must contain UTF-8 text files only')
  }
}

function isSafePackagePath(path: string, allowPinnedHiddenPaths = false): boolean {
  if (validatePortableFilePath(path)) return false
  return path.split('/').every(segment => (
    segment
    && segment !== '.'
    && segment !== '..'
    && (allowPinnedHiddenPaths || !segment.startsWith('.'))
  ))
}

function isAllowedTextPath(path: string, allowPinnedScripts = false): boolean {
  if (!allowPinnedScripts && path.split('/').includes('scripts')) return false
  if (ALLOWED_TEXT_FILENAMES.has(path.split('/').at(-1) ?? '')) return true
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  const extension = path.slice(dot).toLowerCase()
  return ALLOWED_TEXT_EXTENSIONS.has(extension) || (allowPinnedScripts && CURATED_SCRIPT_EXTENSIONS.has(extension))
}

function bundleFile(relativePath: string, content: Uint8Array) {
  let binary = ''
  for (let index = 0; index < content.length; index += 0x8000) {
    binary += String.fromCharCode(...content.subarray(index, index + 0x8000))
  }
  return { relativePath, contentBase64: btoa(binary), size: content.byteLength }
}
