// input: The real desktop custom-provider runtime and Responses tool SSE.
// output: A replay preserving native call IDs separately from function item IDs.
// pos: Managed catalog v2 tool/history protocol regression boundary.
import { expect, test } from 'bun:test'
import { PiModelRuntime } from './pi-model-runtime'
import type { PiInitMessage } from '../../shared/src/agent/backend/pi/protocol'
import { cloneManagedModelCatalog } from '../../shared/src/config/managed-model-catalog'
import { protocolCompletion } from './managed-fallback.fixture'

test('managed Responses replay reconciles tool call IDs and item IDs through the synthetic provider', async () => {
  const requests: any[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests.push(await request.json())
    if (requests.length > 1) return protocolCompletion('openai-responses', 'gpt-6.1-sol')
    const item = { type: 'function_call', id: 'fc_item_v2', call_id: 'call_v2', name: 'echo', arguments: '{}' }
    const events = [
      { type: 'response.created', response: { id: 'resp_v2', status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: '{}' },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp_v2', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ]
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    const config: PiInitMessage = {
      type: 'init', apiKey: 'loopback', model: 'gpt-6.1-sol', cwd: '/tmp', thinkingLevel: 'low',
      workspaceRootPath: '', sessionId: 'v2', sessionPath: '', workingDirectory: '/tmp', plansFolderPath: '',
      baseUrl: `http://127.0.0.1:${server.port}/v1`, customEndpoint: { api: 'openai-responses' },
      customModels: cloneManagedModelCatalog('openai-responses'), managedConnection: { slug: 'storyflow-managed', autoFallback: false },
    }
    const runtime = new PiModelRuntime(() => config, () => {}, () => {})
    const models = await runtime.getModelsRuntime()
    const model = runtime.resolveModel(models, config.model, 'test')!
    const user = { role: 'user' as const, content: 'Use echo.', timestamp: Date.now() }
    const assistant = await models.completeSimple(model, { messages: [user] }, { maxRetries: 0 })
    const call = assistant.content.find(block => block.type === 'toolCall')!
    expect(call).toMatchObject({ id: 'call_v2|fc_item_v2', name: 'echo' })
    const result = await models.completeSimple(model, { messages: [user, assistant, {
      role: 'toolResult', toolCallId: call.id, toolName: 'echo', content: [{ type: 'text', text: 'OK' }], isError: false, timestamp: Date.now(),
    }] }, { maxRetries: 0 })
    expect(result.stopReason).toBe('stop')
    const replay = requests[1].input
    expect(replay.find((item: any) => item.type === 'function_call')).toMatchObject({ id: 'fc_item_v2', call_id: 'call_v2' })
    expect(replay.find((item: any) => item.type === 'function_call_output')).toMatchObject({ call_id: 'call_v2' })
  } finally { server.stop(true) }
})
