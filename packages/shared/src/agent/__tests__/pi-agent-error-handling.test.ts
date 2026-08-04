// input: Synthetic subprocess messages and PiAgent runtime configuration
// output: Assertions for user-visible error and Extension notification mapping
// pos: Regression coverage for the Pi subprocess protocol boundary

import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/craft-agent-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/craft-agent-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
    ...overrides,
  }
}

describe('PiAgent subprocess error handling', () => {
  it('preserves Extension notification severity', () => {
    const agent = new PiAgent(createConfig())
    const enqueued: unknown[] = []
    ;(agent as any).eventQueue.enqueue = (event: unknown) => enqueued.push(event)

    ;(agent as any).handleLine(JSON.stringify({
      type: 'extension_notification',
      message: 'No checkpoints available',
      level: 'warning',
    }))

    expect(enqueued).toEqual([{
      type: 'info',
      message: 'No checkpoints available',
      level: 'warning',
    }])
    agent.destroy()
  })

  it('maps raw HTML subprocess errors to typed proxy_error events', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      message: '<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>cloudflare</center></body></html>',
    }))

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].type).toBe('typed_error')
    expect(enqueued[0].error.code).toBe('proxy_error')
    expect(enqueued[0].error.message.toLowerCase()).not.toContain('<html')

    agent.destroy()
  })

  it('leaves managed gateway presentation to the session boundary', () => {
    const agent = new PiAgent(createConfig({
      connectionSlug: 'storyflow-managed',
      authType: 'api_key',
    }))

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      message: '401 {"error":{"code":"auth_failed","message":"ApiKey Validate fail","type":"auth_failed"}}',
    }))

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].type).toBe('typed_error')
    expect(enqueued[0].error.code).toBe('invalid_api_key')
    expect(enqueued[0].error.actions.some((action: any) => action.action === 'reauth')).toBe(false)
    expect(enqueued[0].error.actions.some((action: any) => action.action === 'settings')).toBe(true)

    agent.destroy()
  })

  it('pushes the latest API credential into a live subprocess', async () => {
    const agent = new PiAgent(createConfig({
      connectionSlug: 'storyflow-managed',
      authType: 'api_key',
    }))
    const sent: unknown[] = []
    ;(agent as any).subprocess = {}
    ;(agent as any).getPiAuth = async () => ({
      provider: 'openai',
      credential: { type: 'api_key', key: 'rotated-token' },
    })
    ;(agent as any).send = (message: unknown) => sent.push(message)

    await expect(agent.reloadCredentials()).resolves.toBe(true)
    expect(sent).toEqual([{
      type: 'token_update',
      piAuth: {
        provider: 'openai',
        credential: { type: 'api_key', key: 'rotated-token' },
      },
    }])

    ;(agent as any).subprocess = null
    agent.destroy()
  })

  it('pushes host-provided managed model access without a stored provider credential', async () => {
    const agent = new PiAgent(createConfig({
      connectionSlug: 'test-managed-explicit-access',
      authType: 'api_key',
      runtime: { piAuthProvider: 'openai' },
    }))
    const sent: unknown[] = []
    ;(agent as any).subprocess = {}
    ;(agent as any).send = (message: unknown) => sent.push(message)

    await expect(agent.reloadCredentials({ token: 'managed-model-token' })).resolves.toBe(true)
    expect(sent).toEqual([{
      type: 'token_update',
      piAuth: {
        provider: 'openai',
        credential: { type: 'api_key', key: 'managed-model-token' },
      },
    }])

    ;(agent as any).subprocess = null
    agent.destroy()
  })

  it('does not enqueue chat errors for llm_query_error messages', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      code: 'llm_query_error',
      message: '<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>cloudflare</center></body></html>',
    }))

    expect(enqueued).toHaveLength(0)

    agent.destroy()
  })

  it('suppresses only identical consecutive subprocess errors', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    for (let i = 0; i < 4; i++) {
      ;(agent as any).handleLine(JSON.stringify({
        type: 'error',
        message: 'EFAULT: broken pipe',
      }))
    }

    expect(enqueued).toHaveLength(3)
    expect(enqueued.every((event) => event.type === 'error' || event.type === 'typed_error')).toBe(true)

    agent.destroy()
  })

  it('resets repeated subprocess error suppression after non-error traffic', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    for (let i = 0; i < 3; i++) {
      ;(agent as any).handleLine(JSON.stringify({
        type: 'error',
        message: 'EFAULT: broken pipe',
      }))
    }

    ;(agent as any).handleLine(JSON.stringify({
      type: 'event',
      event: { type: 'agent_message_delta', delta: 'ok' },
    }))

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      message: 'EFAULT: broken pipe',
    }))

    expect(enqueued.filter((event) => event.type === 'error' || event.type === 'typed_error')).toHaveLength(4)

    agent.destroy()
  })
})
