// input: Project-owned permission files and Host consent state
// output: Regression coverage that Project content cannot expand permissions by itself
// pos: Security contract for capability-specific Project trust

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getSourcePermissionsPath,
  getWorkspacePermissionsPath,
  permissionsConfigCache,
} from '../permissions-config.ts'

const workspacePattern = '^project-permission-test$'
const sourcePattern = '^source-permission-test$'

function writePermissions(path: string, pattern: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({
    version: '2026-08-26',
    allowedBashPatterns: [pattern],
  }))
}

afterEach(() => permissionsConfigCache.clear())

describe('Project permission capability trust', () => {
  it('ignores Project and Project Source permission grants until the Host consents', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'storyflow-project-permissions-'))
    try {
      writePermissions(getWorkspacePermissionsPath(rootPath), workspacePattern)
      writePermissions(getSourcePermissionsPath(rootPath, 'project-source'), sourcePattern)

      const untrusted = permissionsConfigCache.getMergedConfig({
        workspaceRootPath: rootPath,
        activeSourceSlugs: ['project-source'],
      })
      expect(untrusted.readOnlyBashPatterns.some(pattern => pattern.source === workspacePattern)).toBe(false)
      expect(untrusted.readOnlyBashPatterns.some(pattern => pattern.source === sourcePattern)).toBe(false)

      const trusted = permissionsConfigCache.getMergedConfig({
        workspaceRootPath: rootPath,
        activeSourceSlugs: ['project-source'],
        allowProjectGrants: true,
      })
      expect(trusted.readOnlyBashPatterns.some(pattern => pattern.source === workspacePattern)).toBe(true)
      expect(trusted.readOnlyBashPatterns.some(pattern => pattern.source === sourcePattern)).toBe(true)
    } finally {
      rmSync(rootPath, { recursive: true, force: true })
    }
  })
})
