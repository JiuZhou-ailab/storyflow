import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import {
  resolveModelRefreshCredentials,
} from './index'
import type { LlmConnection } from '@craft-agent/shared/config'

const MODEL_FETCHERS_MODULE_PATH = pathToFileURL(join(import.meta.dir, 'index.ts')).href

function setupModelRefreshConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-model-refresh-'))
  const workspaceRoot = join(configDir, 'workspaces', 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      defaultLlmConnection: 'pi-api',
      llmConnections: [{
        slug: 'pi-api',
        name: 'Pi API',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'openai',
        createdAt: Date.now(),
      }],
    }, null, 2),
    'utf-8',
  )

  return configDir
}

function runModelRefreshEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `const { initModelRefreshService } = await import('${MODEL_FETCHERS_MODULE_PATH}'); ${code}`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }

  return run.stdout.toString().trim().split(/\r?\n/).at(-1) ?? ''
}

describe('ModelRefreshService credentials', () => {
  it('passes the full connection to the credential resolver', () => {
    const configDir = setupModelRefreshConfigDir()

    const output = runModelRefreshEval(configDir, `
      let seen = null;
      const service = initModelRefreshService(async (connection) => {
        seen = {
          slug: connection.slug,
          providerType: connection.providerType,
          authType: connection.authType,
        };
        return {};
      });
      await service.refreshNow('pi-api');
      service.stopAll();
      console.log(JSON.stringify(seen));
    `)

    expect(JSON.parse(output)).toEqual({
      slug: 'pi-api',
      providerType: 'pi',
      authType: 'api_key',
    })
  })

  it('resolves only API-key credentials for API-key auth', async () => {
    const connection: LlmConnection = {
      slug: 'anthropic-api',
      name: 'Anthropic API',
      providerType: 'anthropic',
      authType: 'api_key',
      createdAt: Date.now(),
    }
    const calls: string[] = []

    const credentials = await resolveModelRefreshCredentials(connection, {
      getLlmApiKey: async (slug: string) => {
        calls.push(`api:${slug}`)
        return 'sk-test'
      },
      getLlmOAuth: async (slug: string) => {
        calls.push(`oauth:${slug}`)
        return { accessToken: 'oauth-token' }
      },
    })

    expect(credentials).toEqual({ apiKey: 'sk-test' })
    expect(calls).toEqual(['api:anthropic-api'])
  })

  it('resolves only OAuth credentials for OAuth auth', async () => {
    const connection: LlmConnection = {
      slug: 'anthropic-oauth',
      name: 'Anthropic OAuth',
      providerType: 'anthropic',
      authType: 'oauth',
      createdAt: Date.now(),
    }
    const calls: string[] = []

    const credentials = await resolveModelRefreshCredentials(connection, {
      getLlmApiKey: async (slug: string) => {
        calls.push(`api:${slug}`)
        return 'sk-test'
      },
      getLlmOAuth: async (slug: string) => {
        calls.push(`oauth:${slug}`)
        return {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        }
      },
    })

    expect(credentials).toEqual({
      oauthAccessToken: 'access-token',
      oauthRefreshToken: 'refresh-token',
      oauthIdToken: 'id-token',
    })
    expect(calls).toEqual(['oauth:anthropic-oauth'])
  })
})
