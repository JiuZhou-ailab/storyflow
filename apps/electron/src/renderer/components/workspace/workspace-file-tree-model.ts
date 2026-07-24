// input: Native workspace file and directory snapshots plus project identity
// output: Stable, sorted hierarchical nodes for the virtualized workspace tree
// pos: Pure projection layer between filesystem truth and React Arborist

export interface WorkspaceCatalogFile {
  path: string
  relativePath: string
}

export interface WorkspaceFileTreeNode {
  id: string
  name: string
  path: string
  relativePath: string
  type: 'root' | 'directory' | 'file'
  fileCount: number
  children?: WorkspaceFileTreeNode[]
}

interface MutableDirectoryNode {
  name: string
  path: string
  relativePath: string
  type: 'root' | 'directory'
  fileCount: number
  directories: Map<string, MutableDirectoryNode>
  files: WorkspaceFileTreeNode[]
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})
const WORKSPACE_EDITABLE_FILE_EXTENSIONS = new Set(['.md', '.txt'])

function joinWorkspacePath(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/[\\/]+$/, '')
  const relative = relativePath.replace(/^[\\/]+/, '')
  return relative ? `${root}/${relative}` : root
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function joinRelativePath(parentRelativePath: string, name: string): string {
  const parent = normalizeRelativePath(parentRelativePath)
  return parent ? `${parent}/${name}` : name
}

function getFileExtension(name: string): string | null {
  const match = name.match(/(\.[^/.]+)$/)
  return match?.[1]?.toLowerCase() ?? null
}

function normalizeWorkspaceEntryName(input: string): string | null {
  const name = input.trim()
  if (!name || name === '.' || name === '..') return null
  if (/[/\\\u0000-\u001f]/.test(name)) return null
  return name
}

export type WorkspaceCreateEntryKind = 'file' | 'directory'

export function resolveWorkspaceCreateRelativePath(
  parentRelativePath: string,
  input: string,
  kind: WorkspaceCreateEntryKind,
): string | null {
  let name = normalizeWorkspaceEntryName(input)
  if (!name) return null

  if (kind === 'file') {
    const extension = getFileExtension(name)
    if (!extension) {
      name = `${name}.md`
    } else if (!WORKSPACE_EDITABLE_FILE_EXTENSIONS.has(extension) || name.length === extension.length) {
      return null
    }
  }

  return joinRelativePath(parentRelativePath, name)
}

export function resolveWorkspaceImportRelativePath(
  parentRelativePath: string,
  sourcePath: string,
): string | null {
  const normalizedSourcePath = sourcePath.trim().replace(/\\/g, '/')
  const name = normalizeWorkspaceEntryName(normalizedSourcePath.split('/').pop() ?? '')
  if (!name) return null

  const extension = getFileExtension(name)
  if (!extension || !WORKSPACE_EDITABLE_FILE_EXTENSIONS.has(extension) || name.length === extension.length) {
    return null
  }

  return joinRelativePath(parentRelativePath, name)
}

function fileName(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized
}

function createDirectoryNode(
  name: string,
  relativePath: string,
  rootPath: string,
  type: 'root' | 'directory' = 'directory',
): MutableDirectoryNode {
  return {
    name,
    path: joinWorkspacePath(rootPath, relativePath),
    relativePath,
    type,
    fileCount: 0,
    directories: new Map(),
    files: [],
  }
}

function ensureDirectory(root: MutableDirectoryNode, relativePath: string, rootPath: string): MutableDirectoryNode {
  const segments = normalizeRelativePath(relativePath).split('/').filter(Boolean)
  let current = root

  for (const segment of segments) {
    const childRelativePath = current.relativePath ? `${current.relativePath}/${segment}` : segment
    let child = current.directories.get(segment)
    if (!child) {
      child = createDirectoryNode(segment, childRelativePath, rootPath)
      current.directories.set(segment, child)
    }
    current = child
  }
  return current
}

function finalizeDirectory(node: MutableDirectoryNode, workspaceId: string): WorkspaceFileTreeNode {
  const children = [
    ...[...node.directories.values()]
      .sort((left, right) => collator.compare(left.name, right.name))
      .map(child => finalizeDirectory(child, workspaceId)),
    ...node.files.sort((left, right) => collator.compare(left.name, right.name)),
  ]
  node.fileCount = children.reduce((count, child) => count + (child.type === 'file' ? 1 : child.fileCount), 0)

  return {
    id: node.type === 'root'
      ? `writing:project:${workspaceId}`
      : `writing:folder:${node.relativePath}`,
    name: node.name,
    path: node.path,
    relativePath: node.relativePath,
    type: node.type,
    fileCount: node.fileCount,
    // Empty directories must retain [] so React Arborist treats them as folders.
    children,
  }
}

/**
 * Default open nodes for a workspace with no persisted expand state.
 * Content folders are user-owned organization, not application-defined schema.
 */
export function getDefaultWritingExpandedIds(workspaceId: string): string[] {
  return [`writing:project:${workspaceId}`]
}

export interface BuildWorkspaceFileTreeInput {
  workspaceId: string
  workspaceName: string
  rootPath: string
  files: readonly WorkspaceCatalogFile[]
  directories: readonly string[]
}

export function buildWorkspaceFileTree({
  workspaceId,
  workspaceName,
  rootPath,
  files,
  directories,
}: BuildWorkspaceFileTreeInput): WorkspaceFileTreeNode {
  const root = createDirectoryNode(workspaceName, '', rootPath, 'root')

  for (const directory of directories) {
    ensureDirectory(root, directory, rootPath)
  }

  for (const file of files) {
    const normalizedRelativePath = normalizeRelativePath(file.relativePath)
    if (!normalizedRelativePath) continue
    const lastSeparator = normalizedRelativePath.lastIndexOf('/')
    const parentRelativePath = lastSeparator >= 0 ? normalizedRelativePath.slice(0, lastSeparator) : ''
    const parent = ensureDirectory(root, parentRelativePath, rootPath)
    parent.files.push({
      id: `writing:file:${file.path}`,
      name: fileName(normalizedRelativePath),
      path: file.path,
      relativePath: normalizedRelativePath,
      type: 'file',
      fileCount: 1,
    })
  }

  return finalizeDirectory(root, workspaceId)
}
