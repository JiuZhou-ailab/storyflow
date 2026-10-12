import { expect, it, spyOn } from 'bun:test'
import { toast } from 'sonner'
import { createConversationWithFeedback } from '../ActivityRailRows'
import type { TFunction } from 'i18next'

it('catches a busy creation and offers a retry that also catches repeated failure', async () => {
  const error = spyOn(toast, 'error').mockImplementation(() => 'toast')
  let attempts = 0
  const create = async () => { attempts++; throw Object.assign(new Error('storage'), { code: 'SESSION_STORAGE_BUSY' }) }
  const t = ((key: string) => key) as TFunction
  try {
    await createConversationWithFeedback(create, t)
    expect(error.mock.calls[0]?.[0]).toBe('sessions.create.storageBusy')
    const action = error.mock.calls[0]?.[1]?.action
    if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('missing retry')
    await action.onClick({} as any)
    expect(attempts).toBe(2)
    expect(error.mock.calls.length).toBe(2)
  } finally {
    error.mockRestore()
  }
})
