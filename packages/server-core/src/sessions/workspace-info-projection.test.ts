// input: Host Workspace records containing client-safe and Host-only fields
// output: Regression coverage for the exact WorkspaceInfo RPC projection
// pos: Guards the remote server DTO boundary from Host capability metadata leaks

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIsolatedJson } from './isolated-test-runner'

const SESSION_MANAGER_PATH = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href

describe('WorkspaceInfo projection', () => {
  it('returns only the explicit client-safe contract', () => {
    const parent = mkdtempSync(join(tmpdir(), 'storyflow-workspace-info-'))
    const configDir = join(parent, 'host')
    const projectRoot = join(parent, 'project')
    mkdirSync(join(projectRoot, '.craft-agent'), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(projectRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-private', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1,
    }))
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{
        id: 'project-1', name: 'Project', slug: 'project', rootPath: projectRoot, createdAt: 1,
        lastAccessedAt: 2, archivedAt: 3, iconUrl: 'icon.png', mcpUrl: 'https://mcp.example',
        mcpAuthType: 'public', defaultPermissionMode: 'allow-all',
        remoteServer: {
          url: 'wss://remote.example', credentialRef: 'credential-ref',
          remoteWorkspaceId: 'remote-project', token: 'must-not-cross-rpc',
        },
        defaultEnabledSourceRefs: ['workspace:private:identity'], directoryConfigId: 'directory-private',
        localMcpEnabled: true, automationsEnabled: true,
      }],
      activeWorkspaceId: 'project-1', activeSessionId: null,
    }))

    try {
      const result = runIsolatedJson(configDir, 'WORKSPACE_INFO', `
          import { SessionManager } from '${SESSION_MANAGER_PATH}';
          const manager = new SessionManager();
          console.log('WORKSPACE_INFO=' + JSON.stringify(manager.getWorkspacesInfo()[0]));
          manager.cleanup();
        `)
      expect(result).toEqual({
        id: 'project-1',
        name: 'Project',
        slug: 'project',
        lastAccessedAt: 2,
        archivedAt: 3,
        iconUrl: 'icon.png',
        mcpUrl: 'https://mcp.example',
        mcpAuthType: 'public',
        remoteServer: {
          url: 'wss://remote.example',
          credentialRef: 'credential-ref',
          remoteWorkspaceId: 'remote-project',
        },
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
