import { expect, it, mock, spyOn } from 'bun:test'
import { Api } from 'grammy'
import { TelegramAdapter } from './index'
import type { MessagingLogger } from '../../types'

function textUpdate(id: number, text: string) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      chat: { id: 10, type: 'private' as const, first_name: 'Alice' },
      from: { id: 10, is_bot: false, first_name: 'Alice' },
      text,
    },
  }
}

it('logs a failed Telegram update and handles a later poll', async () => {
  const updates = [textUpdate(1, '/bind sess-1'), textUpdate(2, '/help')]
  let polls = 0
  const spies = [
    spyOn(Api.prototype, 'getMe').mockResolvedValue({
      id: 42, is_bot: true, first_name: 'Test Bot', username: 'test_bot',
      can_join_groups: true, can_read_all_group_messages: false, can_manage_bots: false,
      supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
      has_topics_enabled: false, allows_users_to_create_topics: false,
    }),
    spyOn(Api.prototype, 'deleteWebhook').mockResolvedValue(true),
    spyOn(Api.prototype, 'getWebhookInfo').mockResolvedValue({
      url: '', has_custom_certificate: false, pending_update_count: 0,
    }),
    spyOn(Api.prototype, 'getUpdates').mockImplementation(async (_options, signal) => {
      if (!signal || signal.aborted) return []
      const update = updates[polls++]
      if (update) return [update]
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve([]), { once: true }))
    }),
  ]
  const adapter = new TelegramAdapter()
  const handled: string[] = []
  const result = Promise.withResolvers<'handled' | 'stopped'>()
  const error = mock((message: string) => {
    if (message.includes('polling stopped')) result.resolve('stopped')
  })
  const logger: MessagingLogger = { info: () => {}, warn: () => {}, error, child: () => logger }
  adapter.onMessage(async ({ text }) => {
    handled.push(text)
    if (text === '/bind sess-1') throw new Error('Failed to save messaging bindings.')
    result.resolve('handled')
  })

  try {
    await adapter.initialize({ token: 'fake-token', logger })
    expect(await result.promise).toBe('handled')
    expect(handled).toEqual(['/bind sess-1', '/help'])
    expect(adapter.isConnected()).toBe(true)
    expect(error).toHaveBeenCalledWith('Telegram update handler failed', expect.objectContaining({
      updateId: 1,
      error: expect.objectContaining({ message: 'Failed to save messaging bindings.' }),
    }))
  } finally {
    try {
      await adapter.destroy()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  }
})
