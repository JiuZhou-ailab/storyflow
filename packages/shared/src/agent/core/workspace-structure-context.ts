// input: Workspace filesystem roots and bounded snapshot options
// output: Structured workspace tree snapshots and prompt context rendering
// pos: Canonical per-turn workspace structure anchor for agent prompt context

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_WORKSPACE_STRUCTURE_MAX_ENTRIES = 120;
export const DEFAULT_WORKSPACE_STRUCTURE_MAX_DEPTH = 4;

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '.cache',
  '.turbo',
  'out',
  '.output',
]);

export interface WorkspaceStructureSnapshotOptions {
  maxDepth?: number;
  maxEntries?: number;
  skipDirs?: Set<string>;
}

export interface WorkspaceStructureEntry {
  relativePath: string;
  name: string;
  depth: number;
  type: 'dir' | 'file';
}

export interface WorkspaceStructureSnapshot {
  rootPath: string;
  maxDepth: number;
  maxEntries: number;
  entries: WorkspaceStructureEntry[];
  truncated: boolean;
}

export interface WorkspaceStructureContextOptions {
  activeWorkspaceRoot?: string;
  workingDirectory?: string;
}

interface TreeNode {
  name: string;
  type: 'dir' | 'file';
  children: Map<string, TreeNode>;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sortDirEntries<T extends { name: string; isDirectory: () => boolean }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function normalizeLimits(options: WorkspaceStructureSnapshotOptions): {
  maxDepth: number;
  maxEntries: number;
  skipDirs: Set<string>;
} {
  return {
    maxDepth: Math.max(1, Math.floor(options.maxDepth ?? DEFAULT_WORKSPACE_STRUCTURE_MAX_DEPTH)),
    maxEntries: Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_WORKSPACE_STRUCTURE_MAX_ENTRIES)),
    skipDirs: options.skipDirs ?? DEFAULT_SKIP_DIRS,
  };
}

export function buildWorkspaceStructureSnapshot(
  rootPath: string,
  options: WorkspaceStructureSnapshotOptions = {},
): WorkspaceStructureSnapshot {
  const { maxDepth, maxEntries, skipDirs } = normalizeLimits(options);
  const entries: WorkspaceStructureEntry[] = [];
  let truncated = false;

  if (!rootPath || !isDirectory(rootPath)) {
    return {
      rootPath,
      maxDepth,
      maxEntries,
      entries,
      truncated: false,
    };
  }

  let queue: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
    { absolutePath: rootPath, relativePath: '', depth: 0 },
  ];

  while (queue.length > 0 && entries.length < maxEntries) {
    const nextQueue: typeof queue = [];

    for (const item of queue) {
      if (entries.length >= maxEntries) break;

      let dirEntries;
      try {
        dirEntries = sortDirEntries(readdirSync(item.absolutePath, { withFileTypes: true }));
      } catch {
        continue;
      }

      for (const entry of dirEntries) {
        if (entries.length >= maxEntries) {
          truncated = true;
          break;
        }

        const name = entry.name;
        if (name.startsWith('.') || skipDirs.has(name)) continue;

        const isChildDirectory = entry.isDirectory();
        const relativePath = item.relativePath ? `${item.relativePath}/${name}` : name;
        const depth = item.depth + 1;

        entries.push({
          relativePath: isChildDirectory ? `${relativePath}/` : relativePath,
          name,
          depth,
          type: isChildDirectory ? 'dir' : 'file',
        });

        if (isChildDirectory && depth < maxDepth) {
          nextQueue.push({
            absolutePath: join(item.absolutePath, name),
            relativePath,
            depth,
          });
        } else if (isChildDirectory && depth >= maxDepth) {
          truncated = true;
        }
      }
    }

    queue = nextQueue;
  }

  if (queue.length > 0) truncated = true;

  return {
    rootPath,
    maxDepth,
    maxEntries,
    entries,
    truncated,
  };
}

function createTreeNode(name: string, type: 'dir' | 'file'): TreeNode {
  return {
    name,
    type,
    children: new Map(),
  };
}

function insertEntry(root: TreeNode, entry: WorkspaceStructureEntry): void {
  const normalizedPath = entry.relativePath.replace(/\/+$/, '');
  const segments = normalizedPath.split('/').filter(Boolean);
  let cursor = root;

  segments.forEach((segment, index) => {
    const isLeaf = index === segments.length - 1;
    const type = isLeaf ? entry.type : 'dir';
    const existing = cursor.children.get(segment);
    const child = existing ?? createTreeNode(segment, type);
    cursor.children.set(segment, child);
    cursor = child;
  });
}

function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function renderTreeNode(node: TreeNode, prefix: string, isLast: boolean, lines: string[]): void {
  const connector = isLast ? '`-- ' : '|-- ';
  const displayName = `${node.name}${node.type === 'dir' ? '/' : ''}`;
  lines.push(`${prefix}${connector}${escapeXmlText(displayName)}`);

  const children = sortTreeNodes([...node.children.values()]);
  const childPrefix = `${prefix}${isLast ? '    ' : '|   '}`;
  children.forEach((child, index) => {
    renderTreeNode(child, childPrefix, index === children.length - 1, lines);
  });
}

export function renderWorkspaceStructureTree(snapshot: WorkspaceStructureSnapshot): string {
  const root = createTreeNode('.', 'dir');
  for (const entry of snapshot.entries) {
    insertEntry(root, entry);
  }

  const lines = ['.'];
  const children = sortTreeNodes([...root.children.values()]);
  children.forEach((child, index) => {
    renderTreeNode(child, '', index === children.length - 1, lines);
  });
  return lines.join('\n');
}

export function renderWorkspaceStructureContext(
  snapshot: WorkspaceStructureSnapshot,
  options: WorkspaceStructureContextOptions = {},
): string {
  const attrs = [
    `root="${escapeXmlAttribute(snapshot.rootPath)}"`,
    `maxDepth="${snapshot.maxDepth}"`,
    `maxEntries="${snapshot.maxEntries}"`,
    `truncated="${snapshot.truncated ? 'true' : 'false'}"`,
  ];

  if (options.activeWorkspaceRoot) {
    attrs.push(`active_workspace_root="${escapeXmlAttribute(options.activeWorkspaceRoot)}"`);
  }
  if (options.workingDirectory) {
    attrs.push(`working_directory="${escapeXmlAttribute(options.workingDirectory)}"`);
  }

  const lines = [
    `<workspace_structure ${attrs.join(' ')}>`,
    '<rules>',
    '- Treat this block as the current workspace/filesystem anchor for this turn.',
    '- Do not invent paths from display names; before writing, target a listed path or search/read the workspace.',
    '- This tree is bounded and path-only; read files before relying on contents.',
    '- If truncated=true or a path is missing, search before assuming the path is absent.',
    '- Durable project deliverables belong in workspace files: drafts, revisions, outlines, plans, notes, state updates, and other project content should be written or updated in the workspace first.',
    '- Use chat for questions, clarification, progress, and summaries. After writing, summarize changed paths instead of duplicating the full durable artifact in chat.',
    '- If the current permission mode blocks writes or the target file cannot be determined safely, say that explicitly and use the allowed planning/clarification path.',
    '</rules>',
    '<tree>',
    renderWorkspaceStructureTree(snapshot),
    '</tree>',
    '</workspace_structure>',
  ];

  return lines.join('\n');
}
