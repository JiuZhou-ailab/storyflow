// input: Built Electron app, a temporary local workspace, and a deterministic OpenAI-compatible HTTP stub
// output: Assertions for account lazy-render, local startup, a real Pi edit turn, version restore, and restart recovery
// pos: Release-gate smoke test for the desktop product's durable core loop

import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strict as assert } from 'node:assert'
import {
  callOn,
  evalOn,
  launchApp,
  sleep,
  waitFor,
  type LaunchedApp,
  type LaunchAppOptions,
} from '../perf/launch.ts'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const WORKSPACE_SLUG = 'core-e2e'
const CONNECTION_SLUG = 'core-e2e-local'
const MODEL_ID = 'core-e2e-model'
const ORIGINAL = '# Core E2E\n\nbefore\n'
const AGENT_EDIT = '# Core E2E\n\nafter agent edit\n'
const USER_DRIFT = '# Core E2E\n\nuncommitted user drift\n'
const launchOptions: LaunchAppOptions = process.env.CRAFT_E2E_ELECTRON_BIN
  ? { executablePath: process.env.CRAFT_E2E_ELECTRON_BIN, packaged: true }
  : {}

interface Fixture {
  configDir: string
  workspaceRoot: string
  targetFile: string
}

async function main(): Promise<void> {
  const fixture = createFixture()
  const model = startModelStub(fixture.targetFile)
  let app: LaunchedApp | undefined

  try {
    configureAccountSmokeEnvironment()
    configureModel(fixture, model.url)
    app = await launchApp(fixture.configDir, launchOptions)

    const auth = await callOn<{ required: boolean; configured: boolean; authenticated: boolean }>(
      app,
      'async function () { return await window.electronAPI.getClientAuthState() }',
    )
    assert.equal(auth.required, false, 'local projects must open without client login')
    assert.equal(auth.configured, true, 'account smoke must exercise the configured sign-in form')
    assert.equal(auth.authenticated, false, 'account smoke fixture must start signed out')
    await smokeAccountCenter(app)

    const workspace = await callOn<{ id: string; rootPath: string } | undefined>(
      app,
      `async function (id) {
        return (await window.electronAPI.getWorkspaces()).find(workspace => workspace.id === id)
      }`,
      [WORKSPACE_ID],
    )
    assert.equal(workspace?.rootPath, fixture.workspaceRoot)
    assert.equal(readFileSync(fixture.targetFile, 'utf8'), ORIGINAL, 'workspace changed during app startup')

    const userHeadBefore = git(fixture.workspaceRoot, 'rev-parse', 'HEAD')
    const userIndexBefore = git(fixture.workspaceRoot, 'diff', '--cached', '--binary')

    const session = await callOn<{ id: string }>(
      app,
      `async function (workspaceId, rootPath, connection, model) {
        return await window.electronAPI.createSession(workspaceId, {
          name: 'Core E2E',
          permissionMode: 'allow-all',
          workingDirectory: rootPath,
          llmConnection: connection,
          model,
        })
      }`,
      [WORKSPACE_ID, fixture.workspaceRoot, CONNECTION_SLUG, MODEL_ID],
    )
    assert.equal(readFileSync(fixture.targetFile, 'utf8'), ORIGINAL, 'workspace changed during session creation')

    await callOn<void>(
      app,
      `async function (sessionId) {
        await window.electronAPI.sendMessage(
          sessionId,
          'Edit README.md so its final line is exactly: after agent edit'
        )
      }`,
      [session.id],
    )
    await waitForAgent(app, session.id, fixture.targetFile)
    assert.equal(readFileSync(fixture.targetFile, 'utf8'), AGENT_EDIT)

    const version = await callOn<{ created: boolean; commitHash?: string }>(
      app,
      `async function (rootPath) {
        return await window.electronAPI.createWorkspaceVersion(rootPath, {
          reason: 'agent-turn',
          label: 'Core E2E agent edit',
        })
      }`,
      [fixture.workspaceRoot],
    )
    assert.equal(version.created, true)
    assert.ok(version.commitHash)
    assert.equal(git(fixture.workspaceRoot, 'rev-parse', 'HEAD'), userHeadBefore)
    assert.equal(git(fixture.workspaceRoot, 'diff', '--cached', '--binary'), userIndexBefore)
    assert.match(git(fixture.workspaceRoot, 'status', '--short'), /M README\.md/)

    writeFileSync(fixture.targetFile, USER_DRIFT)
    const restored = await callOn<{ restored: boolean; commitHash: string }>(
      app,
      `async function (rootPath, commitHash) {
        return await window.electronAPI.restoreWorkspaceVersion(rootPath, commitHash)
      }`,
      [fixture.workspaceRoot, version.commitHash],
    )
    assert.equal(restored.restored, true)
    assert.equal(readFileSync(fixture.targetFile, 'utf8'), AGENT_EDIT)
    assert.equal(git(fixture.workspaceRoot, 'rev-parse', 'HEAD'), userHeadBefore)
    assert.equal(git(fixture.workspaceRoot, 'diff', '--cached', '--binary'), userIndexBefore)

    await sleep(250)
    await app.close()
    app = await launchApp(fixture.configDir, launchOptions)

    const recovered = await callOn<Array<{ id: string }>>(
      app,
      'async function () { return await window.electronAPI.getSessions() }',
    )
    assert.ok(recovered.some(candidate => candidate.id === session.id))
    assert.equal(readFileSync(fixture.targetFile, 'utf8'), AGENT_EDIT)

    process.stdout.write('core Electron E2E: PASS\n')
  } finally {
    await app?.close().catch(() => {})
    model.stop()
    rmSync(fixture.configDir, { recursive: true, force: true })
  }
}

function configureAccountSmokeEnvironment(): void {
  process.env.CRAFT_CLIENT_AUTH_BROKER_URL = 'https://broker.example.invalid'
  process.env.CRAFT_CLIENT_NEON_AUTH_BASE_URL = 'https://auth.example.invalid'
}

async function smokeAccountCenter(app: LaunchedApp): Promise<void> {
  const rendererErrors: string[] = []
  const onException = (params: any, sessionId?: string) => {
    if (sessionId === app.sid) {
      rendererErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'renderer exception')
    }
  }
  const onConsole = (params: any, sessionId?: string) => {
    if (sessionId !== app.sid || params.type !== 'error') return
    rendererErrors.push((params.args ?? [])
      .map((arg: any) => arg.value ?? arg.description ?? '')
      .filter(Boolean)
      .join(' '))
  }
  app.cdp.on('Runtime.exceptionThrown', onException)
  app.cdp.on('Runtime.consoleAPICalled', onConsole)

  try {
    const profileSelector = '[data-tutorial="activity-profile"]'
    await waitFor(
      app,
      `!!document.querySelector('${profileSelector}')`,
      15_000,
      'rendered account profile entry',
    )
    // This fixture validates the account route, not the Motion-driven startup transition.
    // Reveal the already-rendered shell so CDP can exercise the real pointer path.
    await callOn<void>(app, `function () {
      const style = document.createElement('style')
      style.textContent = '.z-splash { display: none !important; }'
      document.head.append(style)
    }`)
    if (await evalOn<boolean>(app, `!!document.querySelector('[role="dialog"]')`)) {
      for (const type of ['keyDown', 'keyUp'] as const) {
        await app.cdp.send(
          'Input.dispatchKeyEvent',
          { type, key: 'Escape', code: 'Escape' },
          app.sid,
        )
      }
      await waitFor(
        app,
        `!document.querySelector('[role="dialog"]')`,
        5_000,
        'startup announcement dismissal',
      )
    }
    await clickSelector(app, profileSelector)
    await waitFor(
      app,
      `!!document.querySelector('[data-tutorial="activity-account"]')`,
      10_000,
      'account menu item',
    )
    await clickSelector(app, '[data-tutorial="activity-account"]')
    await waitFor(
      app,
      `!!document.querySelector('#client-auth-identifier')
        || !!document.querySelector('[data-testid="root-crash-fallback"]')`,
      15_000,
      'account route result',
    )
    const account = await evalOn<{ crashed: boolean; heading: boolean; signIn: boolean; text: string }>(
      app,
      `({
        crashed: !!document.querySelector('[data-testid="root-crash-fallback"]'),
        heading: Array.from(document.querySelectorAll('h1')).some(el => el.textContent?.trim() === '账户'),
        signIn: !!document.querySelector('#client-auth-identifier'),
        text: document.body.textContent?.trim().slice(0, 500) ?? '',
      })`,
    )
    assert.deepEqual(rendererErrors, [], `account center emitted renderer errors: ${rendererErrors.join('\n')}`)
    assert.equal(account.crashed, false, `account center entered the root error boundary: ${account.text}`)
    assert.equal(account.heading, true, `account center did not render: ${account.text}`)
    assert.equal(account.signIn, true, `configured account sign-in form did not render: ${account.text}`)
  } finally {
    app.cdp.off('Runtime.exceptionThrown', onException)
    app.cdp.off('Runtime.consoleAPICalled', onConsole)
  }
}

async function clickSelector(app: LaunchedApp, selector: string): Promise<void> {
  const selectorLiteral = JSON.stringify(selector)
  await waitFor(
    app,
    `(() => {
      const element = document.querySelector(${selectorLiteral})
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return hit === element || element.contains(hit)
    })()`,
    15_000,
    `clickable target: ${selector}`,
  )
  const box = await callOn<{ x: number; y: number } | null>(
    app,
    `function (selector) {
      const element = document.querySelector(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return null
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      }
    }`,
    [selector],
  )
  assert.ok(box, `click target is missing or hidden: ${selector}`)
  await app.cdp.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: box.x, y: box.y, button: 'none' },
    app.sid,
  )
  await app.cdp.send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 },
    app.sid,
  )
  await app.cdp.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 },
    app.sid,
  )
}

function createFixture(): Fixture {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-core-e2e-'))
  const workspaceRoot = join(configDir, 'workspaces', WORKSPACE_SLUG)
  const stateDir = join(workspaceRoot, '.craft-agent')
  const targetFile = join(workspaceRoot, 'README.md')
  const now = Date.now()

  mkdirSync(join(stateDir, 'sessions'), { recursive: true })
  mkdirSync(join(stateDir, 'statuses'), { recursive: true })
  mkdirSync(join(stateDir, 'labels'), { recursive: true })
  writeJson(join(configDir, 'config.json'), {
    workspaces: [{
      id: WORKSPACE_ID,
      name: 'Core E2E',
      slug: WORKSPACE_SLUG,
      rootPath: workspaceRoot,
      createdAt: now,
    }],
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: null,
    llmConnections: [],
  })
  writeJson(join(stateDir, 'config.json'), {
    id: WORKSPACE_ID,
    name: 'Core E2E',
    slug: WORKSPACE_SLUG,
    defaults: {
      defaultLlmConnection: CONNECTION_SLUG,
      model: MODEL_ID,
      permissionMode: 'allow-all',
      cyclablePermissionModes: ['ask', 'allow-all'],
      enabledSourceSlugs: [],
      workingDirectory: workspaceRoot,
    },
    localMcpServers: { enabled: false },
    createdAt: now,
    updatedAt: now,
  })
  writeJson(join(stateDir, 'statuses', 'config.json'), {
    version: 1,
    statuses: [
      { id: 'backlog', label: 'Backlog', category: 'open', isFixed: false, isDefault: true, order: 0 },
      { id: 'done', label: 'Done', category: 'closed', isFixed: true, isDefault: false, order: 1 },
    ],
  })
  writeJson(join(stateDir, 'labels', 'config.json'), { version: 1, labels: [] })
  writeFileSync(targetFile, ORIGINAL)

  git(workspaceRoot, 'init', '--initial-branch=main')
  git(workspaceRoot, 'config', 'core.autocrlf', 'false')
  git(workspaceRoot, 'config', 'user.name', 'Core E2E')
  git(workspaceRoot, 'config', 'user.email', 'core-e2e@example.invalid')
  git(workspaceRoot, 'add', 'README.md')
  git(workspaceRoot, 'commit', '-m', 'baseline')
  assert.equal(readFileSync(targetFile, 'utf8'), ORIGINAL, 'Git fixture setup changed README.md')

  return { configDir, workspaceRoot, targetFile }
}

function configureModel(fixture: Fixture, baseUrl: string): void {
  const configPath = join(fixture.configDir, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.llmConnections = [{
    slug: CONNECTION_SLUG,
    name: 'Core E2E local model',
    providerType: 'pi_compat',
    baseUrl,
    authType: 'none',
    models: [MODEL_ID],
    defaultModel: MODEL_ID,
    customEndpoint: { api: 'openai-completions' },
    createdAt: Date.now(),
  }]
  config.defaultLlmConnection = CONNECTION_SLUG
  writeJson(configPath, config)
}

function startModelStub(targetFile: string): { url: string; stop(): void } {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/chat/completions')) {
        return new Response('not found', { status: 404 })
      }

      const body = await request.json() as {
        model?: string
        messages?: Array<{ role?: string }>
        tools?: Array<{ function?: { name?: string } }>
      }
      const hasEdit = body.tools?.some(tool => tool.function?.name === 'edit') ?? false
      const hasToolResult = body.messages?.some(message => message.role === 'tool') ?? false
      const chunks = hasEdit && !hasToolResult
        ? toolCallChunks(body.model ?? MODEL_ID, targetFile)
        : textChunks(
            body.model ?? MODEL_ID,
            hasEdit && readFileSync(targetFile, 'utf8') === AGENT_EDIT
              ? 'Edit complete.'
              : hasEdit ? 'Edit failed.' : 'Core E2E',
          )

      return new Response(chunks.join(''), {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        },
      })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    stop: () => server.stop(true),
  }
}

function toolCallChunks(model: string, targetFile: string): string[] {
  const id = 'chatcmpl-core-e2e'
  const args = JSON.stringify({
    path: targetFile,
    edits: [{ oldText: ORIGINAL, newText: AGENT_EDIT }],
  })
  return [
    sse({ id, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
    sse({
      id,
      model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_core_e2e_edit',
            type: 'function',
            function: { name: 'edit', arguments: args },
          }],
        },
        finish_reason: null,
      }],
    }),
    sse({ id, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    'data: [DONE]\n\n',
  ]
}

function textChunks(model: string, text: string): string[] {
  const id = 'chatcmpl-core-e2e-final'
  return [
    sse({ id, model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] }),
    sse({ id, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n',
  ]
}

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}

async function waitForAgent(app: LaunchedApp, sessionId: string, targetFile: string): Promise<void> {
  const deadline = Date.now() + 90_000
  let lastState: {
    processing: boolean
    messages: Array<{
      role: string
      content: string
      toolName?: string
      toolResult?: string
      isError?: boolean
      error?: string
    }>
  } | null = null
  while (Date.now() < deadline) {
    const state = await callOn<{
      processing: boolean
      messages: Array<{
        role: string
        content: string
        toolName?: string
        toolResult?: string
        isError?: boolean
        error?: string
      }>
    } | null>(
      app,
      `async function (id) {
        const session = await window.electronAPI.getSessionMessages(id)
        if (!session) return null
        return {
          processing: session.isProcessing,
          messages: session.messages.slice(-5).map(message => ({
            role: message.role,
            content: message.content,
            toolName: message.toolName,
            toolResult: message.toolResult,
            isError: message.isError,
            error: message.error,
          })),
        }
      }`,
      [sessionId],
    ).catch(() => null)
    lastState = state
    if (
      state?.messages.some(message => message.role === 'assistant')
      && !state.processing
      && readFileSync(targetFile, 'utf8') === AGENT_EDIT
    ) return
    await sleep(100)
  }
  throw new Error(
    `Timed out waiting for the real Pi edit turn: state=${JSON.stringify(lastState)} file=${JSON.stringify(readFileSync(targetFile, 'utf8'))}`,
  )
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

await main()
