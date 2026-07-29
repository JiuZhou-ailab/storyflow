// input: Electron build outputs and staged resources under dist/
// output: Failing build status when a packaged runtime asset is missing or empty
// pos: Final Electron-local build gate before packaging or launch

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const electronDir = join(import.meta.dir, '..');
const distDir = join(electronDir, 'dist');

const requiredFiles = [
  ['main.cjs', 'main process'],
  ['bootstrap-preload.cjs', 'window preload'],
  ['browser-toolbar-preload.cjs', 'browser toolbar preload'],
  ['interceptor.cjs', 'Pi network interceptor'],
  ['renderer/index.html', 'renderer entrypoint'],
  ['resources/agent-defaults/global-skills/anysearch/SKILL.md', 'AnySearch Skill'],
  ['resources/agent-defaults/global-skills/anysearch/scripts/anysearch_cli.js', 'AnySearch Node.js runtime'],
  ['resources/agent-defaults/global-skills/find-skills/SKILL.md', 'Find Skills Skill'],
  ['resources/agent-defaults/global-skills/find-skills/LICENSE.txt', 'Find Skills license'],
  ['resources/agent-defaults/global-skills/skill-creator/SKILL.md', 'Storyflow Skill Creator'],
  ['resources/agent-defaults/global-skills/sn2s-novel-to-screenplay/SKILL.md', 'SN2S novel-to-screenplay Skill'],
  ['resources/agent-defaults/global-skills/sn2s-novel-to-screenplay/scripts/screenplay_project.py', 'SN2S local project helper'],
  ['resources/config-defaults.json', 'configuration defaults'],
  ['resources/docs/craft-cli.md', 'CLI documentation'],
  ['resources/permissions/default.json', 'default permissions'],
  ['resources/release-notes/whats-new.json', 'update announcement manifest'],
  ['resources/themes/default.json', 'default theme'],
  ['resources/tool-icons/tool-icons.json', 'tool icon manifest'],
  ['resources/session-mcp-server/index.js', 'session MCP server'],
  ['resources/pi-agent-server/index.js', 'Pi agent server'],
  ['resources/scripts/markitdown_cli.py', 'document conversion runtime'],
  ['resources/bin/markitdown', 'Unix document conversion launcher'],
  ['resources/bin/markitdown.cmd', 'Windows document conversion launcher'],
  ['resources/powershell-parser.ps1', 'PowerShell command parser'],
] as const;

const requiredDirectories = [
  ['resources/docs', 'documentation'],
  ['resources/release-notes', 'release notes'],
  ['resources/themes', 'preset themes'],
  ['resources/tool-icons', 'tool icons'],
] as const;

const failures: string[] = [];

for (const [assetPath, description] of requiredFiles) {
  const absolutePath = join(distDir, assetPath);
  try {
    const stats = statSync(absolutePath);
    if (!stats.isFile() || stats.size === 0) {
      failures.push(`${assetPath} (${description}) is not a non-empty file`);
    }
  } catch {
    failures.push(`${assetPath} (${description}) is missing`);
  }
}

for (const [assetPath, description] of requiredDirectories) {
  const absolutePath = join(distDir, assetPath);
  try {
    if (readdirSync(absolutePath).length === 0) {
      failures.push(`${assetPath} (${description}) is empty`);
    }
  } catch {
    failures.push(`${assetPath} (${description}) is missing`);
  }
}

if (failures.length > 0) {
  console.error('Electron build asset validation failed:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`✓ Validated ${requiredFiles.length} files and ${requiredDirectories.length} directories in ${relative(electronDir, distDir)}/`);
