// input: Untrusted single-Skill ResourceBundle JSON
// output: Strict text-only package validation for published Skills
// pos: Portable publication trust boundary; curated recommendations never become synthetic packages

import type { ResourceBundle } from '@craft-agent/shared/resources'
import {
  STORYFLOW_SKILL_MANIFEST_FILE,
  type StoryflowSkillManifest,
  validateStoryflowSkillManifest,
  sha256Hex,
} from '@craft-agent/shared/skills/marketplace'

const MAX_PACKAGE_BYTES = 5 * 1024 * 1024
const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES = 128
const ALLOWED_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv'])

export interface ValidatedMarketBundle {
  bundle: ResourceBundle
  raw: string
  bytes: number
  sha256: string
  manifest: StoryflowSkillManifest
  skillMarkdown: string
  files: ReadonlyMap<string, string>
}

export async function validateMarketBundle(value: string | unknown): Promise<ValidatedMarketBundle> {
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
  let totalDecodedBytes = 0
  for (const file of skill.files) {
    if (!file || typeof file.relativePath !== 'string' || !isSafePackagePath(file.relativePath)) {
      throw new Error('Skill package contains an unsafe path')
    }
    if (decoded.has(file.relativePath)) throw new Error(`Duplicate package path: ${file.relativePath}`)
    if (!isAllowedTextPath(file.relativePath)) throw new Error(`Unsupported executable or binary path: ${file.relativePath}`)
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
  if (!/^name:\s*.+$/m.test(skillMarkdown)) throw new Error('SKILL.md needs a non-empty name')
  if (!/^description:\s*.+$/m.test(skillMarkdown) || !skillMarkdown.replace(/^---[\s\S]*?---/, '').trim()) {
    throw new Error('SKILL.md needs description frontmatter and a non-empty body')
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

function isSafePackagePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('//')) return false
  return path.split('/').every(segment => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.'))
}

function isAllowedTextPath(path: string): boolean {
  if (path.split('/').includes('scripts')) return false
  const dot = path.lastIndexOf('.')
  return dot >= 0 && ALLOWED_TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase())
}
