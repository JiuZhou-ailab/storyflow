// input: Bundled LLM defaults fixtures and temporary config directories
// output: Regression coverage for managed default connection and credential seeding behavior
// pos: Tests distribution-provided LLM connection bootstrapping
import { describe, expect, it } from 'bun:test'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { applyBuiltinLlmConnectionDefaults, type StoredConfig } from '../storage.ts'
import type { ConfigDefaults } from '../config-defaults-schema.ts'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href
const UTILS_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'utils', 'index.ts')).href
const CREDENTIALS_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'credentials', 'index.ts')).href

function makeConfig(overrides: Partial<StoredConfig> = {}): StoredConfig {
  return {
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
    llmConnections: [],
    ...overrides,
  }
}

function makeDefaults(overrides: Partial<ConfigDefaults['builtinLlmConnection']> = {}): ConfigDefaults {
  return {
    version: 'test',
    description: 'test defaults',
    defaults: {
      notificationsEnabled: true,
      colorTheme: 'default',
      autoCapitalisation: true,
      sendMessageKey: 'enter',
      spellCheck: false,
      keepAwakeWhileRunning: false,
      richToolDescriptions: true,
      extendedPromptCache: false,
      browserToolEnabled: true,
    },
    workspaceDefaults: {
      thinkingLevel: 'medium',
      permissionMode: 'ask',
      cyclablePermissionModes: ['safe', 'ask', 'allow-all'],
      localMcpServers: { enabled: true },
    },
    builtinLlmConnection: {
      enabled: true,
      connection: {
        slug: 'wangsu-default',
        name: 'Internal Default',
        providerType: 'pi_compat',
        authType: 'api_key_with_endpoint',
        baseUrl: 'https://example.internal/v1',
        defaultModel: 'internal-model',
        models: ['internal-model'],
        modelSelectionMode: 'userDefined3Tier',
        customEndpoint: { api: 'anthropic-messages' },
        hidden: true,
        managed: true,
        source: 'builtin',
        createdAt: 0,
      },
      apiKey: 'internal-secret',
      ...overrides,
    },
  }
}

describe('builtin LLM connection defaults', () => {
  it('adds the bundled managed connection and returns the credential without storing it in config', () => {
    const config = makeConfig()
    const result = applyBuiltinLlmConnectionDefaults(config, makeDefaults())

    expect(result.changed).toBe(true)
    expect(result.credentialToSeed).toEqual({
      connectionSlug: 'wangsu-default',
      apiKey: 'internal-secret',
    })
    expect(config.defaultLlmConnection).toBe('wangsu-default')
    expect(config.llmConnections).toHaveLength(1)
    expect(config.llmConnections?.[0]).toMatchObject({
      slug: 'wangsu-default',
      hidden: true,
      managed: true,
    })
    expect(JSON.stringify(config)).not.toContain('internal-secret')
  })

  it('promotes the bundled managed connection as the default even when a legacy default exists', () => {
    const config = makeConfig({
      defaultLlmConnection: 'user-default',
      llmConnections: [{
        slug: 'user-default',
        name: 'User Default',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: 1,
      }],
    })

    const result = applyBuiltinLlmConnectionDefaults(config, makeDefaults())

    expect(result.changed).toBe(true)
    expect(config.defaultLlmConnection).toBe('wangsu-default')
    expect(config.llmConnections?.map(c => c.slug)).toEqual(['user-default', 'wangsu-default'])
  })

  it('is idempotent when the bundled connection already exists', () => {
    const config = makeConfig({
      defaultLlmConnection: 'wangsu-default',
      llmConnections: [makeDefaults().builtinLlmConnection!.connection!],
    })

    const result = applyBuiltinLlmConnectionDefaults(config, makeDefaults())

    expect(result.changed).toBe(false)
    expect(result.credentialToSeed).toEqual({
      connectionSlug: 'wangsu-default',
      apiKey: 'internal-secret',
    })
    expect(config.llmConnections).toHaveLength(1)
  })

  it('updates existing managed bundled connection metadata', () => {
    const config = makeConfig({
      defaultLlmConnection: 'wangsu-default',
      llmConnections: [{
        ...makeDefaults().builtinLlmConnection!.connection!,
        name: '网宿',
        hidden: true,
        managed: true,
        source: 'builtin',
      }],
    })

    const result = applyBuiltinLlmConnectionDefaults(config, makeDefaults({
      connection: {
        ...makeDefaults().builtinLlmConnection!.connection!,
        name: 'JiuZhou',
        hidden: false,
      },
      apiKey: '',
    }))

    expect(result.changed).toBe(true)
    expect(config.llmConnections?.[0]?.name).toBe('JiuZhou')
    expect(config.llmConnections?.[0]?.hidden).toBe(false)
    expect(result.credentialToSeed).toBeUndefined()
  })

  it('ignores disabled defaults', () => {
    const config = makeConfig()
    const result = applyBuiltinLlmConnectionDefaults(config, makeDefaults({ enabled: false }))

    expect(result.changed).toBe(false)
    expect(result.credentialToSeed).toBeUndefined()
    expect(config.llmConnections).toEqual([])
  })

  it('adds the bundled managed connection without seeding a credential when no API key is bundled', () => {
    const config = makeConfig()
    const result = applyBuiltinLlmConnectionDefaults(config, makeDefaults({ apiKey: '' }))

    expect(result.changed).toBe(true)
    expect(result.credentialToSeed).toBeUndefined()
    expect(config.defaultLlmConnection).toBe('wangsu-default')
    expect(config.llmConnections?.[0]).toMatchObject({
      slug: 'wangsu-default',
      hidden: true,
      managed: true,
    })
  })

  it('seeds the managed gateway credential from CRAFT_BUILTIN_LLM_API_KEY when the bundle omits a key', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-builtin-env-'))
    const bundledRoot = join(configDir, 'bundle')
    const bundledResources = join(bundledRoot, 'resources')
    mkdirSync(bundledResources, { recursive: true })

    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        workspaces: [],
        activeWorkspaceId: null,
        activeSessionId: null,
        llmConnections: [],
      }, null, 2),
      'utf-8',
    )
    writeFileSync(
      join(bundledResources, 'config-defaults.json'),
      JSON.stringify(makeDefaults({ apiKey: '' }), null, 2),
      'utf-8',
    )

    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `
        import { setBundledAssetsRoot } from '${UTILS_MODULE_PATH}';
        import { seedBuiltinLlmConnectionFromDefaults } from '${STORAGE_MODULE_PATH}';
        import { getCredentialManager } from '${CREDENTIALS_MODULE_PATH}';
        setBundledAssetsRoot(${JSON.stringify(bundledRoot)});
        await seedBuiltinLlmConnectionFromDefaults();
        const key = await getCredentialManager().getLlmApiKey('wangsu-default');
        console.log(key ?? '');
      `,
    ], {
      env: {
        ...process.env,
        CRAFT_CONFIG_DIR: configDir,
        CRAFT_BUILTIN_LLM_API_KEY: 'env-managed-secret',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (run.exitCode !== 0) {
      throw new Error(`env seed subprocess failed:\n${run.stderr.toString()}`)
    }

    expect(run.stdout.toString().trim()).toBe('env-managed-secret')
    expect(readFileSync(join(configDir, 'config.json'), 'utf-8')).not.toContain('env-managed-secret')
    expect(readFileSync(join(configDir, 'config-defaults.json'), 'utf-8')).not.toContain('env-managed-secret')
  })

  it('seeds the credential from bundled defaults without copying the key to local config files', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-builtin-'))
    const bundledRoot = join(configDir, 'bundle')
    const bundledResources = join(bundledRoot, 'resources')
    mkdirSync(bundledResources, { recursive: true })

    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        workspaces: [],
        activeWorkspaceId: null,
        activeSessionId: null,
        llmConnections: [],
      }, null, 2),
      'utf-8',
    )
    writeFileSync(
      join(bundledResources, 'config-defaults.json'),
      JSON.stringify(makeDefaults(), null, 2),
      'utf-8',
    )

    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `
        import { setBundledAssetsRoot } from '${UTILS_MODULE_PATH}';
        import { seedBuiltinLlmConnectionFromDefaults } from '${STORAGE_MODULE_PATH}';
        import { getCredentialManager } from '${CREDENTIALS_MODULE_PATH}';
        setBundledAssetsRoot(${JSON.stringify(bundledRoot)});
        await seedBuiltinLlmConnectionFromDefaults();
        const key = await getCredentialManager().getLlmApiKey('wangsu-default');
        console.log(key ?? '');
      `,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (run.exitCode !== 0) {
      throw new Error(`seed subprocess failed:\n${run.stderr.toString()}`)
    }

    expect(run.stdout.toString().trim()).toBe('internal-secret')
    expect(readFileSync(join(configDir, 'config.json'), 'utf-8')).not.toContain('internal-secret')
    expect(readFileSync(join(configDir, 'config-defaults.json'), 'utf-8')).not.toContain('internal-secret')
    expect(existsSync(join(configDir, 'credentials.enc'))).toBe(true)
  })

  it('removes a revoked bundled credential without touching user-provided credentials', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-revoked-builtin-'))
    const bundledRoot = join(configDir, 'bundle')
    const bundledResources = join(bundledRoot, 'resources')
    mkdirSync(bundledResources, { recursive: true })

    const revokedKey = 'revoked-distribution-key'
    const revokedHash = createHash('sha256').update(revokedKey, 'utf8').digest('hex')

    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        workspaces: [],
        activeWorkspaceId: null,
        activeSessionId: null,
        llmConnections: [],
      }, null, 2),
      'utf-8',
    )
    writeFileSync(
      join(bundledResources, 'config-defaults.json'),
      JSON.stringify(makeDefaults({
        apiKey: '',
        revokedApiKeySha256: [revokedHash],
      }), null, 2),
      'utf-8',
    )

    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `
        import { setBundledAssetsRoot } from '${UTILS_MODULE_PATH}';
        import { seedBuiltinLlmConnectionFromDefaults } from '${STORAGE_MODULE_PATH}';
        import { getCredentialManager } from '${CREDENTIALS_MODULE_PATH}';
        setBundledAssetsRoot(${JSON.stringify(bundledRoot)});
        const manager = getCredentialManager();
        await manager.setLlmApiKey('wangsu-default', ${JSON.stringify(revokedKey)});
        await seedBuiltinLlmConnectionFromDefaults();
        const afterRevoked = await manager.getLlmApiKey('wangsu-default');
        await manager.setLlmApiKey('wangsu-default', 'author-owned-key');
        await seedBuiltinLlmConnectionFromDefaults();
        const afterUserKey = await manager.getLlmApiKey('wangsu-default');
        console.log(JSON.stringify({ afterRevoked, afterUserKey }));
      `,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (run.exitCode !== 0) {
      throw new Error(`revoked seed subprocess failed:\n${run.stderr.toString()}`)
    }

    expect(JSON.parse(run.stdout.toString().trim())).toEqual({
      afterRevoked: null,
      afterUserKey: 'author-owned-key',
    })
  })
})
