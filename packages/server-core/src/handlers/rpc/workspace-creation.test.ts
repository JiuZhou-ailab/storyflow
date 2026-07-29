// input: Current and legacy workspace creation RPC payloads
// output: Regression tests for remote-only option normalization
// pos: Server-core compatibility guard for blank workspace creation

import { describe, expect, it } from 'bun:test'
import { normalizeCreateWorkspaceOptions } from './workspace-creation'

describe('normalizeCreateWorkspaceOptions', () => {
  it('keeps a legacy remoteServer argument while ignoring the fourth project type argument', () => {
    const remoteServer = {
      url: 'ws://localhost:9100',
      token: 'token',
      remoteWorkspaceId: 'remote-ws',
    }

    expect(normalizeCreateWorkspaceOptions(remoteServer, 'novel')).toEqual({
      remoteServer,
    })
  })

  it('keeps only remoteServer from a legacy options payload', () => {
    const options = {
      projectType: 'novel' as const,
      methodPackId: 'novel.claude-book' as const,
      remoteServer: {
        url: 'ws://localhost:9100',
        token: 'token',
        remoteWorkspaceId: 'remote-ws',
      },
    }

    expect(normalizeCreateWorkspaceOptions(options)).toEqual({
      remoteServer: options.remoteServer,
    })
  })

  it('ignores legacy project fields when no remote server is configured', () => {
    expect(normalizeCreateWorkspaceOptions({
      projectType: 'novel',
      methodPackId: 'novel.claude-book',
    })).toEqual({})
  })

  it('rejects malformed remote configuration instead of creating a local workspace', () => {
    expect(() => normalizeCreateWorkspaceOptions({
      remoteServer: {
        url: 'https://storyflow.example.test',
        token: 'token',
        remoteWorkspaceId: 'remote-ws',
      },
    })).toThrow('must use ws:// or wss://')

    expect(() => normalizeCreateWorkspaceOptions({
      remoteServer: {
        url: 'wss://storyflow.example.test',
        token: ' ',
        remoteWorkspaceId: 'remote-ws',
      },
    })).toThrow('cannot be blank')
  })
})
