// input: Temporary persisted connections, credential resolvers, and provider catalog responses
// output: Regression coverage for managed model reconciliation and auth-specific credential lookup
// pos: Public ModelRefreshService contract tests

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

function setupManagedModelRefreshConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-managed-model-refresh-'))
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
      defaultLlmConnection: 'storyflow-managed',
      llmConnections: [{
        slug: 'storyflow-managed',
        name: 'GPT (Responses)',
        providerType: 'pi_compat',
        authType: 'api_key_with_endpoint',
        baseUrl: 'https://model.example.com/v1',
        customEndpoint: { api: 'openai-responses' },
        models: [
          {
            id: 'gpt-5.5',
            name: 'GPT-5.5',
            shortName: 'GPT',
            description: '',
            provider: 'pi',
            contextWindow: 131_072,
          },
          {
            id: 'gpt-5.6-sol',
            name: 'GPT-5.6 Sol',
            shortName: 'GPT',
            description: '',
            provider: 'pi',
            contextWindow: 131_072,
          },
          {
            id: 'retired-model',
            name: 'Retired Model',
            shortName: 'Retired',
            description: '',
            provider: 'pi',
            contextWindow: 131_072,
          },
        ],
        defaultModel: 'retired-model',
        managed: true,
        source: 'builtin',
        createdAt: 0,
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
  it('reconciles the managed connection to the authenticated gateway catalog', () => {
    const configDir = setupManagedModelRefreshConfigDir()

    const output = runModelRefreshEval(configDir, `
      globalThis.fetch = async (input, init) => {
        if (String(input) !== 'https://model.example.com/v1/models') {
          throw new Error('unexpected URL: ' + String(input));
        }
        if (new Headers(init?.headers).get('authorization') !== 'Bearer managed-token') {
          throw new Error('missing managed token');
        }
        return Response.json({
          object: 'list',
          data: [
            {
              id: 'gpt-5.5',
              name: 'GPT-5.5',
              short_name: 'GPT',
              description: '',
              provider: 'pi',
              context_window: 262144,
              supports_thinking: true,
              thinking_level_map: { low: 'low', max: null },
              supports_images: true,
              api: 'openai-responses',
            },
            {
              id: 'gpt-5.6-sol',
              name: 'GPT-5.6 Sol',
              short_name: 'GPT',
              description: '',
              provider: 'pi',
              context_window: 262144,
              supports_thinking: true,
              thinking_level_map: { low: 'low', max: 'max' },
              supports_images: true,
              api: 'openai-responses',
            },
            {
              id: 'gemini-3.6-flash',
              name: 'Gemini 3.6 Flash',
              short_name: 'Gemini',
              description: '',
              provider: 'pi',
              context_window: 1000000,
              supports_thinking: false,
              supports_images: true,
              api: 'google-generative-ai',
            },
          ],
        });
      };
      const service = initModelRefreshService(async () => ({ apiKey: 'managed-token' }));
      await service.refreshNow('storyflow-managed');
      const { getLlmConnection } = await import('@craft-agent/shared/config');
      console.log(JSON.stringify(getLlmConnection('storyflow-managed')));
    `)

    const connection = JSON.parse(output)
    expect(connection.defaultModel).toBe('gpt-5.5')
    expect(connection.models).toEqual([
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        shortName: 'GPT',
        description: '',
        provider: 'pi',
        contextWindow: 262_144,
        supportsThinking: true,
        thinkingLevelMap: { low: 'low', max: null },
        supportsImages: true,
      },
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        shortName: 'GPT',
        description: '',
        provider: 'pi',
        contextWindow: 262_144,
        supportsThinking: true,
        thinkingLevelMap: { low: 'low', max: 'max' },
        supportsImages: true,
      },
    ])
  })

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

  it('lets runtime startup own the initial refresh', () => {
    const configDir = setupModelRefreshConfigDir()

    const output = runModelRefreshEval(configDir, `
      let credentialCalls = 0;
      const service = initModelRefreshService(async () => {
        credentialCalls += 1;
        return {};
      });
      await service.refreshAfterCredentialChange('pi-api');
      const beforeStart = credentialCalls;
      service.startAll();
      await new Promise(resolve => setTimeout(resolve, 20));
      const afterStart = credentialCalls;
      await service.refreshAfterCredentialChange('pi-api');
      service.stopAll();
      console.log(JSON.stringify({ beforeStart, afterStart, afterChange: credentialCalls }));
    `)

    expect(JSON.parse(output)).toEqual({
      beforeStart: 0,
      afterStart: 1,
      afterChange: 2,
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
