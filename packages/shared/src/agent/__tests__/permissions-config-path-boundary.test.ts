// input: Valid external permissions JSON files linked from Project and isolated global roots
// output: Regression coverage for Project ownership guards without changing global symlink semantics
// pos: Filesystem trust-boundary proof for shared permission load and save APIs

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PERMISSIONS_CONFIG_PATH = pathToFileURL(join(import.meta.dir, '..', 'permissions-config.ts')).href
const VALIDATORS_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'config', 'validators.ts')).href

describe('Project permissions path ownership', () => {
  it('rejects external Project permission symlinks while preserving global interop', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-permissions-boundary-'))
    const configDir = join(parent, 'global')
    const projectRoot = join(parent, 'project')
    const outsideRoot = join(parent, 'outside')
    mkdirSync(configDir, { recursive: true })
    mkdirSync(projectRoot)
    mkdirSync(outsideRoot)

    try {
      const run = Bun.spawnSync([
        process.execPath,
        '--eval',
        `
          import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
          import { dirname, join } from 'node:path';
          import {
            getSourcePermissionsPath,
            getWorkspacePermissionsPath,
            loadRawSourcePermissions,
            loadRawWorkspacePermissions,
            loadSourcePermissionsConfig,
            loadWorkspacePermissionsConfig,
            saveSourcePermissions,
            saveWorkspacePermissions,
          } from '${PERMISSIONS_CONFIG_PATH}';
          import { CONFIG_DIR } from '@craft-agent/shared/config';
          import {
            validateAllPermissions,
            validateSourcePermissions,
            validateWorkspacePermissions,
          } from '${VALIDATORS_PATH}';

          const projectRoot = ${JSON.stringify(projectRoot)};
          const outsideRoot = ${JSON.stringify(outsideRoot)};
          const original = pattern => JSON.stringify({
            version: '2026-08-27',
            allowedMcpPatterns: [pattern],
          });
          const replacement = pattern => ({
            version: '2026-08-27',
            allowedMcpPatterns: [pattern],
          });
          const captureError = work => {
            try { work(); return null; }
            catch (error) { return error instanceof Error ? error.message : String(error); }
          };

          const projectWorkspaceExternal = join(outsideRoot, 'project-workspace.json');
          const projectSourceExternal = join(outsideRoot, 'project-source.json');
          writeFileSync(projectWorkspaceExternal, original('project-workspace-outside'));
          writeFileSync(projectSourceExternal, original('project-source-outside'));
          const projectWorkspacePath = getWorkspacePermissionsPath(projectRoot);
          const projectSourcePath = getSourcePermissionsPath(projectRoot, 'project-source');
          mkdirSync(dirname(projectSourcePath), { recursive: true });
          symlinkSync(projectWorkspaceExternal, projectWorkspacePath);
          symlinkSync(projectSourceExternal, projectSourcePath);

          const projectErrors = [
            captureError(() => loadWorkspacePermissionsConfig(projectRoot)),
            captureError(() => loadRawWorkspacePermissions(projectRoot)),
            captureError(() => loadSourcePermissionsConfig(projectRoot, 'project-source')),
            captureError(() => loadRawSourcePermissions(projectRoot, 'project-source')),
            captureError(() => saveWorkspacePermissions(projectRoot, replacement('blocked-workspace-write'))),
            captureError(() => saveSourcePermissions(projectRoot, 'project-source', replacement('blocked-source-write'))),
          ];
          const projectValidation = {
            all: validateAllPermissions(projectRoot),
            workspace: validateWorkspacePermissions(projectRoot),
            source: validateSourcePermissions(projectRoot, 'project-source'),
          };

          const globalWorkspaceExternal = join(outsideRoot, 'global-workspace.json');
          const globalSourceExternal = join(outsideRoot, 'global-source.json');
          writeFileSync(globalWorkspaceExternal, original('global-workspace-outside'));
          writeFileSync(globalSourceExternal, original('global-source-outside'));
          const globalWorkspacePath = getWorkspacePermissionsPath(CONFIG_DIR);
          const globalSourcePath = getSourcePermissionsPath(CONFIG_DIR, 'global-source');
          mkdirSync(dirname(globalSourcePath), { recursive: true });
          symlinkSync(globalWorkspaceExternal, globalWorkspacePath);
          symlinkSync(globalSourceExternal, globalSourcePath);

          const globalLoads = {
            workspace: loadWorkspacePermissionsConfig(CONFIG_DIR)?.allowedMcpPatterns,
            rawWorkspace: loadRawWorkspacePermissions(CONFIG_DIR)?.allowedMcpPatterns,
            source: loadSourcePermissionsConfig(CONFIG_DIR, 'global-source')?.allowedMcpPatterns,
            rawSource: loadRawSourcePermissions(CONFIG_DIR, 'global-source')?.allowedMcpPatterns,
          };
          saveWorkspacePermissions(CONFIG_DIR, replacement('global-workspace-updated'));
          saveSourcePermissions(CONFIG_DIR, 'global-source', replacement('global-source-updated'));

          console.log('PERMISSIONS_BOUNDARY=' + JSON.stringify({
            projectErrors,
            projectValidation,
            projectWorkspace: JSON.parse(readFileSync(projectWorkspaceExternal, 'utf8')).allowedMcpPatterns,
            projectSource: JSON.parse(readFileSync(projectSourceExternal, 'utf8')).allowedMcpPatterns,
            globalLoads,
            globalWorkspace: JSON.parse(readFileSync(globalWorkspaceExternal, 'utf8')).allowedMcpPatterns,
            globalSource: JSON.parse(readFileSync(globalSourceExternal, 'utf8')).allowedMcpPatterns,
          }));
        `,
      ], {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
      const match = run.stdout.toString().match(/PERMISSIONS_BOUNDARY=(\{.*\})/)
      if (!match) throw new Error(`Missing permissions boundary result:\n${run.stdout.toString()}`)
      const result = JSON.parse(match[1]!)
      expect(result.projectErrors).toHaveLength(6)
      expect(result.projectErrors.every((message: unknown) => (
        typeof message === 'string' && message.includes('symbolic link')
      ))).toBe(true)
      expect(result.projectWorkspace).toEqual(['project-workspace-outside'])
      expect(result.projectSource).toEqual(['project-source-outside'])
      expect(result.projectValidation.workspace.valid).toBe(false)
      expect(result.projectValidation.workspace.errors[0]?.message).toContain('symbolic link')
      expect(result.projectValidation.source.valid).toBe(false)
      expect(result.projectValidation.source.errors[0]?.message).toContain('symbolic link')
      expect(result.projectValidation.all.valid).toBe(false)
      expect(result.projectValidation.all.errors.some((error: { message?: string }) => (
        error.message?.includes('symbolic link')
      ))).toBe(true)
      expect(result.globalLoads).toEqual({
        workspace: ['global-workspace-outside'],
        rawWorkspace: ['global-workspace-outside'],
        source: ['global-source-outside'],
        rawSource: ['global-source-outside'],
      })
      expect(result.globalWorkspace).toEqual(['global-workspace-updated'])
      expect(result.globalSource).toEqual(['global-source-updated'])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
