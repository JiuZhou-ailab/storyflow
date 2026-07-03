import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href
const PI_RESOLVER_SETUP_PATH = pathToFileURL(join(import.meta.dir, '..', '..', '..', 'tests', 'setup', 'register-pi-model-resolver.ts')).href

function setupWorkspaceConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  // Make workspace appear valid to loadStoredConfig() so migration can run.
  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify(
      {
        id: 'ws-config-1',
        name: 'My Workspace',
        slug: 'my-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      null,
      2,
    ),
    'utf-8',
  )

  return { configDir, workspaceRoot, configPath: join(configDir, 'config.json') }
}

function writeRootConfig(configPath: string, workspaceRoot: string, llmConnections: any[]) {
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaces: [
          {
            id: 'ws-1',
            name: 'My Workspace',
            rootPath: workspaceRoot,
            createdAt: Date.now(),
          },
        ],
        activeWorkspaceId: 'ws-1',
        activeSessionId: null,
        defaultLlmConnection: 'pi-api-key',
        llmConnections,
      },
      null,
      2,
    ),
    'utf-8',
  )
}

function runMigration(configDir: string) {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import '${PI_RESOLVER_SETUP_PATH}'; import { migrateLegacyLlmConnectionsConfig } from '${STORAGE_MODULE_PATH}'; migrateLegacyLlmConnectionsConfig();`,
  ], {
    env: {
      ...process.env,
      CRAFT_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(
      `migration subprocess failed (exit ${run.exitCode})\nstdout:\n${run.stdout.toString()}\nstderr:\n${run.stderr.toString()}`,
    )
  }
}

function runEnsureConfigDir(configDir: string) {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { ensureConfigDir } from '${STORAGE_MODULE_PATH}'; ensureConfigDir();`,
  ], {
    env: {
      ...process.env,
      CRAFT_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(
      `ensureConfigDir subprocess failed (exit ${run.exitCode})\nstdout:\n${run.stdout.toString()}\nstderr:\n${run.stderr.toString()}`,
    )
  }
}

function runGetWorkspaces(configDir: string): any[] {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { getWorkspaces } from '${STORAGE_MODULE_PATH}'; console.log(JSON.stringify(getWorkspaces()));`,
  ], {
    env: {
      ...process.env,
      CRAFT_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(
      `getWorkspaces subprocess failed (exit ${run.exitCode})\nstdout:\n${run.stdout.toString()}\nstderr:\n${run.stderr.toString()}`,
    )
  }

  return JSON.parse(run.stdout.toString())
}

function readPiApiKeyConnection(configPath: string): any {
  const migrated = JSON.parse(readFileSync(configPath, 'utf-8'))
  return migrated.llmConnections.find((c: any) => c.slug === 'pi-api-key')
}

function getModelIds(connection: any): string[] {
  return (connection.models ?? []).map((m: any) => typeof m === 'string' ? m : m.id)
}

describe('startup migration (integration)', () => {
  it('attaches writing project metadata to workspace DTOs from the manifest', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()
    writeRootConfig(configPath, workspaceRoot, [])
    mkdirSync(join(workspaceRoot, '.craft-agent'), { recursive: true })
    writeFileSync(
      join(workspaceRoot, '.craft-agent', 'craft-writing.json'),
      JSON.stringify({
        schemaVersion: 1,
        type: 'short-form',
        methodPack: { id: 'short-form.article', version: 1 },
      }),
      'utf-8',
    )

    const [workspace] = runGetWorkspaces(configDir)

    expect(workspace.projectType).toBe('short-form')
    expect(workspace.methodPackId).toBe('short-form.article')
  })

  it('backs up config.json once per day before startup mutations', () => {
    const { configDir, configPath } = setupWorkspaceConfigDir()
    const initial = { workspaces: [], activeWorkspaceId: null, activeSessionId: null, marker: 'first' }
    writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf-8')

    runEnsureConfigDir(configDir)

    const backups = readdirSync(configDir).filter(name => /^config\.json\.bak-\d{4}-\d{2}-\d{2}$/.test(name))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(configDir, backups[0]!), 'utf-8')).marker).toBe('first')

    writeFileSync(configPath, JSON.stringify({ ...initial, marker: 'second' }, null, 2), 'utf-8')
    runEnsureConfigDir(configDir)
    const backupsAfterSecondRun = readdirSync(configDir).filter(name => /^config\.json\.bak-\d{4}-\d{2}-\d{2}$/.test(name))
    expect(backupsAfterSecondRun).toEqual(backups)
    expect(JSON.parse(readFileSync(join(configDir, backups[0]!), 'utf-8')).marker).toBe('first')
  })

  it('keeps only the newest three config backups', () => {
    const { configDir, configPath } = setupWorkspaceConfigDir()
    writeFileSync(configPath, JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null }, null, 2), 'utf-8')
    for (const day of ['2026-01-01', '2026-01-02', '2026-01-03']) {
      writeFileSync(join(configDir, `config.json.bak-${day}`), '{}', 'utf-8')
    }

    runEnsureConfigDir(configDir)

    const backups = readdirSync(configDir).filter(name => /^config\.json\.bak-\d{4}-\d{2}-\d{2}$/.test(name)).sort()
    expect(backups).toHaveLength(3)
    expect(backups).not.toContain('config.json.bak-2026-01-01')
  })

  it('repairs broken pi-api-key openai-codex provider on startup migration', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (OpenAI)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'openai-codex',
        createdAt: Date.now(),
        models: [],
        defaultModel: '',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.piAuthProvider).toBe('openai')
    expect(connection.authType).toBe('api_key')
  })

  it('preserves userDefined3Tier model subsets during startup migration', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()
    const userDefinedModels = ['pi/claude-opus-4-6', 'pi/claude-sonnet-4-6', 'pi/claude-haiku-4-5']
    const migratedUserDefinedModels = ['pi/claude-opus-4-8', 'pi/claude-sonnet-4-6', 'pi/claude-haiku-4-5']

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: userDefinedModels,
        defaultModel: userDefinedModels[0],
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('userDefined3Tier')
    expect(connection.models).toEqual(migratedUserDefinedModels)
    expect(connection.defaultModel).toBe(migratedUserDefinedModels[0])
  })

  it('normalizes auto mode model set back to provider defaults', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'automaticallySyncedFromProvider',
        createdAt: Date.now(),
        models: ['pi/claude-haiku-4-5'],
        defaultModel: 'pi/claude-haiku-4-5',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    const modelIds = getModelIds(connection)
    expect(modelIds.length).toBeGreaterThan(1)
    expect(modelIds).toContain('pi/claude-opus-4-7')
    expect(modelIds).toContain(connection.defaultModel)
  })

  it('repairs userDefined3Tier lists by removing invalid IDs and fixing default model', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['pi/claude-opus-4-6', 'pi/not-real', 'pi/claude-haiku-4-5'],
        defaultModel: 'pi/not-real',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('userDefined3Tier')
    expect(connection.models).toEqual(['pi/claude-opus-4-8', 'pi/claude-haiku-4-5'])
    expect(connection.defaultModel).toBe('pi/claude-opus-4-8')
  })

  it('falls back to provider defaults when userDefined3Tier becomes empty after filtering', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['pi/not-real-1', 'pi/not-real-2'],
        defaultModel: 'pi/not-real-1',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('userDefined3Tier')
    const modelIds = getModelIds(connection)
    expect(modelIds.length).toBeGreaterThan(1)
    expect(modelIds).toContain('pi/claude-opus-4-7')
    expect(modelIds).not.toContain('pi/not-real-1')
    expect(connection.defaultModel).toBe(modelIds[0])
  })

  it('normalizes legacy unprefixed userDefined3Tier model IDs instead of resetting', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (OpenRouter)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'openrouter',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['x-ai/grok-4.20', 'openrouter/auto'],
        defaultModel: 'x-ai/grok-4.20',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('userDefined3Tier')
    const modelIds = getModelIds(connection)
    expect(modelIds).toEqual(['pi/x-ai/grok-4.20', 'pi/openrouter/auto'])
    expect(connection.defaultModel).toBe('pi/x-ai/grok-4.20')
  })

  it('migrates legacy bedrock before model backfill so persisted models are Bedrock-native', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'legacy-bedrock',
        name: 'Legacy Bedrock',
        providerType: 'bedrock',
        authType: 'api_key',
        createdAt: Date.now(),
        models: [],
        defaultModel: '',
      },
    ])

    runMigration(configDir)

    const connection = findConnection(configPath, 'legacy-bedrock')
    const ids = modelIdsOf(connection)
    expect(connection.providerType).toBe('pi')
    expect(connection.piAuthProvider).toBe('amazon-bedrock')
    expect(connection.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every(id => id.startsWith('pi/'))).toBe(true)
    expect(ids.some(id => id.includes('anthropic.claude'))).toBe(true)
    expect(connection.defaultModel).toBe(ids[0])
  })

  it('migrates legacy vertex before model backfill so persisted models match google-vertex', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'legacy-vertex',
        name: 'Legacy Vertex',
        providerType: 'vertex',
        authType: 'api_key',
        createdAt: Date.now(),
        models: [],
        defaultModel: '',
      },
    ])

    runMigration(configDir)

    const connection = findConnection(configPath, 'legacy-vertex')
    const ids = modelIdsOf(connection)
    expect(connection.providerType).toBe('pi')
    expect(connection.piAuthProvider).toBe('google-vertex')
    expect(connection.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every(id => id.startsWith('pi/'))).toBe(true)
    expect(connection.defaultModel).toBe(ids[0])
  })
})

function readConfigJson(configPath: string): any {
  return JSON.parse(readFileSync(configPath, 'utf-8'))
}

function findConnection(configPath: string, slug: string): any {
  return readConfigJson(configPath).llmConnections.find((c: any) => c.slug === slug)
}

function modelIdsOf(connection: any): string[] {
  return (connection?.models ?? []).map((m: any) => typeof m === 'string' ? m : m.id)
}

describe('migrateLegacyOpusToDefaultOpus (integration)', () => {
  it('moves direct Anthropic Opus defaults to Opus 4.8 while keeping Opus 4.7 selectable', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'anthropic',
        name: 'Anthropic',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: Date.now(),
        models: [
          { id: 'claude-opus-4-7', name: 'Opus 4.7', shortName: 'Opus', provider: 'anthropic', contextWindow: 1_000_000 },
          { id: 'claude-opus-4-6', name: 'Opus 4.6', shortName: 'Opus', provider: 'anthropic', contextWindow: 200_000 },
          { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', shortName: 'Sonnet', provider: 'anthropic', contextWindow: 200_000 },
          { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', shortName: 'Haiku', provider: 'anthropic', contextWindow: 200_000 },
        ],
        defaultModel: 'claude-opus-4-7',
      },
    ])

    runMigration(configDir)

    const connection = findConnection(configPath, 'anthropic')
    const ids = modelIdsOf(connection)
    expect(ids).toContain('claude-opus-4-8')
    expect(ids).toContain('claude-opus-4-7')
    expect(ids).not.toContain('claude-opus-4-6')
    expect(connection.defaultModel).toBe('claude-opus-4-8')
  })

  it('normalizes pi Opus 4.6 to a selectable current Opus model', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['pi/claude-opus-4-6', 'pi/claude-sonnet-4-6', 'pi/claude-haiku-4-5'],
        defaultModel: 'pi/claude-opus-4-6',
      },
    ])

    runMigration(configDir)

    const connection = findConnection(configPath, 'pi-api-key')
    const ids = modelIdsOf(connection)
    expect(ids).not.toContain('pi/claude-opus-4-6')
    expect(connection.defaultModel).toMatch(/^pi\/claude-opus-4-[78]$/)
    expect(ids).toContain(connection.defaultModel)
  })
})
