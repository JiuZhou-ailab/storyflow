// input: Local Skill directories plus checksum-verified old and target Market bundle bytes
// output: Minimal install receipt queries and modification-preserving explicit Skill upgrades
// pos: Local provenance boundary; Market discovery stays remote and generic overwrite stays separate

import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { collectDirectoryFiles, fromPortableRelPath } from '../utils/bundle-files.ts'
import { isValidSkillSlug, invalidateSkillsCache, validateSkillDocumentForSlug } from '../skills/storage.ts'
import { assertSymlinkFreeTree, resolveProjectOwnedPath } from '../workspaces/paths.ts'
import { validateResourceBundle } from './resource-bundle.ts'
import {
  MAX_SKILL_INSTALL_ARTIFACT_BYTES,
  SKILL_INSTALL_RECEIPT_FILE,
  type ResourceBundle,
  type SkillBundleEntry,
  type SkillInstallArtifact,
  type SkillInstallReceipt,
  type SkillUpgradeOptions,
  type SkillUpgradeResult,
} from './types.ts'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function parseSkillInstallReceipt(value: unknown): SkillInstallReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const receipt = value as Record<string, unknown>
  if (
    receipt.kind !== 'skill'
    || typeof receipt.slug !== 'string'
    || !isValidSkillSlug(receipt.slug)
    || typeof receipt.version !== 'string'
    || !VERSION_PATTERN.test(receipt.version)
    || typeof receipt.sha256 !== 'string'
    || !SHA256_PATTERN.test(receipt.sha256)
    || (receipt.scope !== 'project' && receipt.scope !== 'user')
  ) return null
  return {
    kind: 'skill',
    slug: receipt.slug,
    version: receipt.version,
    sha256: receipt.sha256,
    scope: receipt.scope,
  }
}

/** Read one valid Market install receipt. Invalid or hand-created Skills return null. */
export function readSkillInstallReceipt(skillsRootPath: string, slug: string): SkillInstallReceipt | null {
  if (!isValidSkillSlug(slug)) return null
  const root = resolve(skillsRootPath)
  const skillDirectory = join(root, slug)
  try {
    const rootStat = lstatSync(root)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null
    assertSymlinkFreeTree(skillDirectory)
    const receipt = parseSkillInstallReceipt(JSON.parse(
      readFileSync(join(skillDirectory, SKILL_INSTALL_RECEIPT_FILE), 'utf8'),
    ))
    return receipt?.slug === slug ? receipt : null
  } catch {
    return null
  }
}

/** List valid receipts without treating untracked or malformed local Skills as Market installs. */
export function listSkillInstallReceipts(skillsRootPath: string): SkillInstallReceipt[] {
  const root = resolve(skillsRootPath)
  try {
    const stat = lstatSync(root)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return []
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => readSkillInstallReceipt(root, entry.name))
      .filter((receipt): receipt is SkillInstallReceipt => receipt !== null)
      .sort((a, b) => a.slug.localeCompare(b.slug))
  } catch {
    return []
  }
}

function parseSkillArtifact(artifact: SkillInstallArtifact): SkillBundleEntry {
  if (
    !isValidSkillSlug(artifact.slug)
    || !VERSION_PATTERN.test(artifact.version)
    || !SHA256_PATTERN.test(artifact.sha256)
  ) throw new Error('Invalid Skill install artifact identity')
  if (Buffer.byteLength(artifact.raw) > MAX_SKILL_INSTALL_ARTIFACT_BYTES) {
    throw new Error('Skill install artifact exceeds 5 MB')
  }
  const actualSha256 = createHash('sha256').update(artifact.raw).digest('hex')
  if (actualSha256 !== artifact.sha256) throw new Error('Skill artifact checksum mismatch')

  let bundle: ResourceBundle
  try {
    bundle = JSON.parse(artifact.raw) as ResourceBundle
  } catch {
    throw new Error('Skill artifact is not valid JSON')
  }
  const validation = validateResourceBundle(bundle)
  if (!validation.valid) throw new Error(`Invalid Skill artifact: ${validation.errors.join('; ')}`)
  const skills = bundle.resources.skills
  if (
    !Array.isArray(skills)
    || skills.length !== 1
    || skills[0]?.slug !== artifact.slug
    || bundle.resources.sources !== undefined
    || bundle.resources.automations !== undefined
  ) throw new Error('Skill artifact must contain exactly one matching Skill')
  return skills[0]
}

type LocalPathState =
  | { kind: 'missing' }
  | { kind: 'file'; content: Buffer }
  | { kind: 'other' }

function readLocalPath(path: string): LocalPathState {
  try {
    const stat = lstatSync(path)
    if (stat.isFile()) return { kind: 'file', content: readFileSync(path) }
    return { kind: 'other' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
}

function bundleContent(file: SkillBundleEntry['files'][number]): Buffer {
  return Buffer.from(file.contentBase64, 'base64')
}

function localChanges(
  skillDirectory: string,
  baseFiles: Map<string, SkillBundleEntry['files'][number]>,
): Set<string> {
  const changes = new Set<string>()
  const localFiles = collectDirectoryFiles(skillDirectory)
  for (const file of localFiles) {
    const base = baseFiles.get(file.relativePath)
    if (!base || !bundleContent(base).equals(bundleContent(file))) changes.add(file.relativePath)
  }
  for (const [path, base] of baseFiles) {
    const local = readLocalPath(join(skillDirectory, fromPortableRelPath(path)))
    if (local.kind !== 'file' || !local.content.equals(bundleContent(base))) changes.add(path)
  }
  return changes
}

function removeEmptyParents(path: string, root: string): void {
  let current = dirname(path)
  while (current !== root) {
    try {
      rmSync(current)
    } catch {
      return
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

function canCreateFile(path: string, root: string): boolean {
  let current = dirname(path)
  while (current !== root) {
    if (existsSync(current)) return lstatSync(current).isDirectory()
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
  return true
}

/**
 * Explicitly upgrade a tracked Skill by three-way-merging local files against
 * the immutable bundle named by its receipt. Local edits always win.
 */
export function upgradeInstalledSkill(
  skillsRootPath: string,
  currentArtifact: SkillInstallArtifact,
  targetArtifact: SkillInstallArtifact,
  options: SkillUpgradeOptions,
): SkillUpgradeResult {
  const base = parseSkillArtifact(currentArtifact)
  const target = parseSkillArtifact(targetArtifact)
  if (base.slug !== target.slug) throw new Error('Skill upgrade artifacts have different slugs')

  const root = resolve(skillsRootPath)
  const rootStat = lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Skill root must be a real directory')
  }
  const skillDirectory = join(root, base.slug)
  assertSymlinkFreeTree(skillDirectory)
  const currentReceipt = readSkillInstallReceipt(root, base.slug)
  if (
    !currentReceipt
    || currentReceipt.slug !== currentArtifact.slug
    || currentReceipt.version !== currentArtifact.version
    || currentReceipt.sha256 !== currentArtifact.sha256
  ) throw new Error('Installed receipt does not match the current artifact')
  if (currentReceipt.scope !== options.scope) {
    throw new Error('Installed receipt scope does not match the selected Skill root')
  }
  if (currentReceipt.scope === 'project') {
    if (!options.projectRootPath) throw new Error('Project-scoped Skill upgrade requires its project root')
    resolveProjectOwnedPath(options.projectRootPath, root)
    resolveProjectOwnedPath(options.projectRootPath, skillDirectory)
  }

  if (
    currentArtifact.version === targetArtifact.version
    && currentArtifact.sha256 === targetArtifact.sha256
  ) return { receipt: currentReceipt, preservedPaths: [] }

  const nextReceipt: SkillInstallReceipt = {
    ...currentReceipt,
    version: targetArtifact.version,
    sha256: targetArtifact.sha256,
  }
  const baseFiles = new Map(base.files.map(file => [file.relativePath, file]))
  const targetFiles = new Map(target.files.map(file => [file.relativePath, file]))
  const preservedPaths = localChanges(skillDirectory, baseFiles)
  const stagingDirectory = join(root, `.tmp-${base.slug}-${randomUUID().slice(0, 8)}`)
  const backupDirectory = join(root, `.backup-${base.slug}-${randomUUID().slice(0, 8)}`)

  try {
    cpSync(skillDirectory, stagingDirectory, { recursive: true, errorOnExist: true, force: false })

    // Remove only files that are still byte-identical to the installed base.
    for (const [path, baseFile] of baseFiles) {
      if (targetFiles.has(path)) continue
      const localPath = join(stagingDirectory, fromPortableRelPath(path))
      const local = readLocalPath(localPath)
      if (local.kind === 'file' && local.content.equals(bundleContent(baseFile))) {
        rmSync(localPath)
        removeEmptyParents(localPath, stagingDirectory)
      }
    }

    // Update byte-identical base files and add non-conflicting target files.
    for (const [path, targetFile] of targetFiles) {
      const baseFile = baseFiles.get(path)
      if (baseFile && bundleContent(baseFile).equals(bundleContent(targetFile))) continue
      const localPath = join(stagingDirectory, fromPortableRelPath(path))
      const local = readLocalPath(localPath)
      const canReplace = baseFile
        ? local.kind === 'file' && local.content.equals(bundleContent(baseFile))
        : local.kind === 'missing'
      if (!canReplace || !canCreateFile(localPath, stagingDirectory)) {
        preservedPaths.add(path)
        continue
      }
      mkdirSync(dirname(localPath), { recursive: true })
      writeFileSync(localPath, bundleContent(targetFile))
    }

    const stagedSkillDocument = readFileSync(join(stagingDirectory, 'SKILL.md'), 'utf8')
    const skillError = validateSkillDocumentForSlug(stagedSkillDocument, base.slug)
    if (skillError) throw new Error(`Upgraded Skill is invalid: ${skillError}`)
    writeFileSync(
      join(stagingDirectory, SKILL_INSTALL_RECEIPT_FILE),
      `${JSON.stringify(nextReceipt, null, 2)}\n`,
    )
    assertSymlinkFreeTree(stagingDirectory)

    renameSync(skillDirectory, backupDirectory)
    try {
      renameSync(stagingDirectory, skillDirectory)
    } catch (error) {
      renameSync(backupDirectory, skillDirectory)
      throw error
    }
    try {
      rmSync(backupDirectory, { recursive: true, force: true })
    } catch {
      // The committed Skill is valid; a hidden backup can be cleaned later.
    }
    invalidateSkillsCache()
    return { receipt: nextReceipt, preservedPaths: [...preservedPaths].sort() }
  } catch (error) {
    if (existsSync(stagingDirectory)) rmSync(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}
