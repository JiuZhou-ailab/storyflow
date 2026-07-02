// input: Writing workspace root paths
// output: Shared recommended root folders and starter README
// pos: Keeps product-level workspace roots out of Method Pack-specific scaffolds

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getWorkspaceReadmePath } from "../workspaces/paths.ts";

export const WRITING_MANUSCRIPT_ROOT = "正文";
export const WRITING_GLOBAL_ROOT = "全局";
export const WRITING_FREE_ROOT = "自由区";

export const RECOMMENDED_WRITING_ROOTS = [
  WRITING_MANUSCRIPT_ROOT,
  WRITING_GLOBAL_ROOT,
  WRITING_FREE_ROOT,
] as const;

export function ensureRecommendedWritingRoots(rootPath: string): void {
  for (const dir of RECOMMENDED_WRITING_ROOTS) {
    mkdirSync(join(rootPath, dir), { recursive: true });
  }

  const readmePath = getWorkspaceReadmePath(rootPath);
  if (existsSync(readmePath)) return;

  mkdirSync(dirname(readmePath), { recursive: true });
  writeFileSync(readmePath, `# 推荐目录结构

- 正文/: 已接受正文，每章或每篇一个文件。
- 全局/: 简报、大纲、人物和长期设定。
- 自由区/: 试写、临时方案、审校笔记和废弃版本。
`, "utf-8");
}
