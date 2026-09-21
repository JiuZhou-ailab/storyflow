// input: Electron build outputs and staged resources under dist/
// output: Failing build status when a packaged runtime asset is missing or empty
// pos: Final Electron-local build gate before packaging or launch

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function validateAssets(distDir: string, platform: string): void {
  const piServerBinary = platform === 'win32'
    ? 'pi-agent-server.exe'
    : 'pi-agent-server';

  const documentTools = ['markitdown', 'pdf-tool', 'xlsx-tool', 'docx-tool', 'pptx-tool', 'img-tool', 'doc-diff', 'ical-tool'];
  const requiredFiles = [
    ['main.cjs', 'main process'],
    ['bootstrap-preload.cjs', 'window preload'],
    ['browser-toolbar-preload.cjs', 'browser toolbar preload'],
    ['renderer/index.html', 'renderer entrypoint'],
    ['resources/agent-defaults/global-skills/firecrawl/SKILL.md', 'Firecrawl Skill'],
    ['resources/agent-defaults/global-skills/find-skills/SKILL.md', 'Find Skills Skill'],
    ['resources/agent-defaults/global-skills/find-skills/LICENSE.txt', 'Find Skills license'],
    ['resources/agent-defaults/global-skills/skill-creator/SKILL.md', 'Storyflow Skill Creator'],
    ['resources/agent-defaults/global-skills/skill-creator/LICENSE.txt', 'Skill Creator license'],
    ['resources/agent-defaults/global-skills/storyflow-tutorial/SKILL.md', 'Storyflow Tutorial Skill'],
    ['resources/agent-defaults/global-skills/sn2s-novel-to-screenplay/SKILL.md', 'SN2S novel-to-screenplay Skill'],
    ['resources/agent-defaults/global-skills/sn2s-novel-to-screenplay/scripts/screenplay_project.py', 'SN2S local project helper'],
    ['resources/agent-defaults/sources/storyflow-catalog/config.json', 'Storyflow Catalog Source config'],
    ['resources/agent-defaults/sources/storyflow-catalog/guide.md', 'Storyflow Catalog research guide'],
    ['resources/agent-defaults/sources/storyflow-catalog/permissions.json', 'Storyflow Catalog read-only permissions'],
    ['resources/config-defaults.json', 'configuration defaults'],
    ['resources/docs/craft-cli.md', 'CLI documentation'],
    ['resources/permissions/default.json', 'default permissions'],
    ['resources/release-notes/whats-new.json', 'update announcement manifest'],
    ['resources/themes/default.json', 'default theme'],
    ['resources/tool-icons/tool-icons.json', 'tool icon manifest'],
    [`resources/pi-agent-server/${piServerBinary}`, 'Pi agent server'],
    ...documentTools.flatMap((tool): [string, string][] => [
      [`resources/scripts/${tool === 'markitdown' ? 'markitdown_cli' : tool.replaceAll('-', '_')}.py`, tool],
      [`resources/bin/${tool}`, `${tool} Unix launcher`],
      [`resources/bin/${tool}.cmd`, `${tool} Windows launcher`],
    ]),
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
    throw new Error(`Electron build asset validation failed: ${failures.join('; ')}`);
  }
}

if (import.meta.main) {
  const electronDir = join(import.meta.dir, '..');
  const distDir = join(electronDir, 'dist');
  validateAssets(distDir, process.env.CRAFT_BUILD_PLATFORM || process.platform);
  console.log(`✓ Validated runtime assets in ${relative(electronDir, distDir)}/`);
}
