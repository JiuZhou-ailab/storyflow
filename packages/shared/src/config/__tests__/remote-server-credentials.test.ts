// input: Legacy plaintext remote workspace config and a credential store seam
// output: Migration coverage for encrypted token references and secret-free workspace DTOs
// pos: Trust-boundary regression test for remote workspace persistence

import { describe, expect, it } from 'bun:test'
import {
  migrateRemoteServerCredentials,
  remoteServerCredentialRef,
  type StoredConfig,
} from '../storage'

describe('remote server credentials', () => {
  it('moves legacy plaintext tokens into the credential store before removing them from config', async () => {
    const config = {
      workspaces: [{
        id: 'workspace-1',
        name: 'Remote',
        slug: 'remote',
        rootPath: '/tmp/remote',
        createdAt: 1,
        remoteServer: {
          url: 'wss://storyflow.example.test',
          token: 'plaintext-secret',
          remoteWorkspaceId: 'remote-1',
        },
      }],
      activeWorkspaceId: 'workspace-1',
      activeSessionId: null,
    } as unknown as StoredConfig
    const stored = new Map<string, string>()

    const changed = await migrateRemoteServerCredentials(config, {
      getRemoteServerToken: async (workspaceId) => stored.get(workspaceId) ?? null,
      setRemoteServerToken: async (workspaceId, token) => {
        stored.set(workspaceId, token)
      },
    })

    expect(changed).toBe(true)
    expect(stored.get('workspace-1')).toBe('plaintext-secret')
    expect(config.workspaces[0]?.remoteServer).toEqual({
      url: 'wss://storyflow.example.test',
      credentialRef: remoteServerCredentialRef('workspace-1'),
      remoteWorkspaceId: 'remote-1',
    })
    expect(JSON.stringify(config)).not.toContain('plaintext-secret')
  })

  it('warms existing encrypted credentials without rewriting safe config', async () => {
    const config: StoredConfig = {
      workspaces: [{
        id: 'workspace-1',
        name: 'Remote',
        slug: 'remote',
        rootPath: '/tmp/remote',
        createdAt: 1,
        remoteServer: {
          url: 'wss://storyflow.example.test',
          credentialRef: remoteServerCredentialRef('workspace-1'),
          remoteWorkspaceId: 'remote-1',
        },
      }],
      activeWorkspaceId: 'workspace-1',
      activeSessionId: null,
    }
    const reads: string[] = []

    const changed = await migrateRemoteServerCredentials(config, {
      getRemoteServerToken: async (workspaceId) => {
        reads.push(workspaceId)
        return 'encrypted-secret'
      },
      setRemoteServerToken: async () => {
        throw new Error('must not rewrite')
      },
    })

    expect(changed).toBe(false)
    expect(reads).toEqual(['workspace-1'])
  })
})
