// input: Declarative API tool names and host-owned HTTP operation metadata
// output: Permission decisions based on HTTP semantics instead of untrusted names
// pos: Regression guard for declarative Source operation permissions

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shouldAllowToolInMode, permissionsConfigCache } from '@craft-agent/shared/agent'
import { McpClientPool } from '../mcp-pool'
import { createApiServer } from '@craft-agent/shared/sources'

const temporaryRoots: string[] = []

afterEach(() => {
  permissionsConfigCache.clear()
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('declarative API permissions', () => {
  it('uses HTTP semantics before tool-name heuristics', () => {
    expect(shouldAllowToolInMode(
      'mcp__source__Read',
      {},
      'safe',
      { apiOperation: { method: 'DELETE', path: '/jobs/42' } },
    ).allowed).toBe(false)

    expect(shouldAllowToolInMode(
      'mcp__source__delete_job',
      {},
      'safe',
      { apiOperation: { method: 'GET', path: '/jobs/42' } },
    ).allowed).toBe(true)
  })

  it('checks the canonical request path before applying endpoint rules', async () => {
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'api-permission-path-'))
    temporaryRoots.push(workspaceRootPath)
    writeFileSync(join(workspaceRootPath, 'permissions.json'), JSON.stringify({
      allowedApiEndpoints: [{ method: 'POST', path: '^/allowed/.*$' }],
    }))

    const server = createApiServer({
      name: 'source',
      baseUrl: 'https://api.example.com',
      auth: { type: 'none' },
      operations: [{
        name: 'mutate',
        description: 'Mutate one record.',
        method: 'POST',
        path: '/allowed/{id}/delete',
        parameters: [{ name: 'id', type: 'string', required: true }],
      }],
    }, '')
    const pool = new McpClientPool()

    try {
      await pool.connectInProcess('source', server)
      const apiOperation = pool.getProxyToolPermission('mcp__source__mutate', { id: '..' })
      expect(apiOperation).toEqual({ method: 'POST', path: '/delete' })
      expect(pool.getProxyToolPermission('mcp__source__mutate', {})).toEqual({
        method: 'POST',
        path: '/.storyflow/invalid-api-operation',
      })
      expect(shouldAllowToolInMode(
        'mcp__source__mutate',
        { id: '..' },
        'safe',
        {
          apiOperation,
          permissionsContext: { workspaceRootPath, activeSourceSlugs: [] },
        },
      ).allowed).toBe(false)
    } finally {
      await pool.disconnectAll()
    }
  })

  it('applies path defaults before checking endpoint rules', async () => {
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'api-permission-default-'))
    temporaryRoots.push(workspaceRootPath)
    writeFileSync(join(workspaceRootPath, 'permissions.json'), JSON.stringify({
      allowedApiEndpoints: [{ method: 'POST', path: '^/allowed/.*$' }],
    }))

    const server = createApiServer({
      name: 'source',
      baseUrl: 'https://api.example.com',
      auth: { type: 'none' },
      operations: [{
        name: 'mutate',
        description: 'Mutate one record.',
        method: 'POST',
        path: '/allowed/{id}/delete',
        parameters: [{ name: 'id', type: 'string', default: '..' }],
      }],
    }, '')
    const pool = new McpClientPool()

    try {
      await pool.connectInProcess('source', server)
      const apiOperation = pool.getProxyToolPermission('mcp__source__mutate', {})
      expect(apiOperation).toEqual({ method: 'POST', path: '/delete' })
      expect(shouldAllowToolInMode(
        'mcp__source__mutate',
        {},
        'safe',
        {
          apiOperation,
          permissionsContext: { workspaceRootPath, activeSourceSlugs: [] },
        },
      ).allowed).toBe(false)
    } finally {
      await pool.disconnectAll()
    }
  })
})
