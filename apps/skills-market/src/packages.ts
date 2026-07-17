// input: Curated methodology seeds or untrusted single-Skill ResourceBundle JSON
// output: Deterministic downloadable bundles and strict text-only package validation
// pos: Portable package boundary shared by catalog downloads and contribution intake

import type { ResourceBundle } from '@craft-agent/shared/resources'
import {
  STORYFLOW_SKILL_MANIFEST_FILE,
  type StoryflowSkillManifest,
  validateStoryflowSkillManifest,
  sha256Hex,
} from '@craft-agent/shared/skills/marketplace'
import type { MethodologySeed } from './catalog.ts'

const FIXED_SEED_EXPORT_TIME = Date.parse('2026-07-17T00:00:00.000Z')
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
}

export async function buildSeedBundle(seed: MethodologySeed): Promise<ValidatedMarketBundle> {
  if (seed.distribution !== 'installable') throw new Error('This methodology is reference-only')
  const manifest: StoryflowSkillManifest = {
    schemaVersion: 1,
    slug: seed.slug,
    version: '1.0.0',
    displayName: seed.displayName,
    summary: seed.summary,
    license: seed.license,
    author: { name: 'Storyflow Community Seed', url: seed.sourceUrl },
    tags: [...seed.tags],
    methodology: {
      sourceName: seed.sourceName,
      sourceUrl: seed.sourceUrl,
      adaptation: 'Original Storyflow adaptation. Follow the linked source for the upstream method and license.',
    },
    contributes: {
      projectLayout: {
        roots: seed.roots.map((path, order) => ({ path, order, create: true })),
      },
    },
  }
  const skillMarkdown = buildSkillMarkdown(seed)
  const sourceReference = buildSourceReference(seed)
  const bundle: ResourceBundle = {
    version: 1,
    exportedAt: FIXED_SEED_EXPORT_TIME,
    sourceWorkspace: 'Storyflow Skills Market',
    resources: {
      skills: [{
        slug: seed.slug,
        files: [
          textBundleFile('SKILL.md', skillMarkdown),
          textBundleFile(STORYFLOW_SKILL_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`),
          textBundleFile('references/source.md', sourceReference),
        ],
      }],
    },
  }
  return validateMarketBundle(JSON.stringify(bundle))
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
  if (!new RegExp(`^name:\\s*["']?${escapeRegExp(skill.slug)}["']?\\s*$`, 'm').test(skillMarkdown)) {
    throw new Error('SKILL.md name must match the package slug')
  }
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
  }
}

function buildSkillMarkdown(seed: MethodologySeed): string {
  const roots = seed.roots.map(path => `- \`${path}/\``).join('\n')
  return `---
name: ${seed.slug}
description: ${JSON.stringify(seed.summary)}
metadata:
  displayName: ${JSON.stringify(seed.displayName)}
---

# ${seed.displayName}

${seed.method}

## 使用流程

1. 先确认用户当前任务、已有材料和期望产物；缺失信息会改变结论时再追问。
2. 第一次使用时，只在当前项目中按需创建下列目录，不移动或覆盖已有内容：
${roots}
3. 将事实、观察、判断和待验证项分开记录；不要用方法论术语替代真实证据。
4. 每轮只维护与当前任务直接相关的文件，输出变更摘要和下一步验证信号。
5. 如果目录与项目已有结构冲突，优先复用现有结构并说明映射，不创建平行真相源。

## 完成标准

- 产物能从项目文件追溯到输入与判断依据。
- 新目录服务于真实工作流，而不是为了展示方法论而存在。
- Agent 停止后，用户仍能独立理解并继续维护这些文件。
`
}

function buildSourceReference(seed: MethodologySeed): string {
  return `# 来源与改造说明

- 上游方法：${seed.sourceName}
- 来源：${seed.sourceUrl}
- 许可：${seed.license}
- Storyflow 改造：本 Skill 使用原创措辞，将方法抽象成项目文件、证据记录和 Agent 执行流程；不复制上游模板、图示或示例。
`
}

function textBundleFile(relativePath: string, content: string) {
  const bytes = new TextEncoder().encode(content)
  return { relativePath, contentBase64: encodeBase64(bytes), size: bytes.byteLength }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
