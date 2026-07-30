// input: Session transcript entries and rewind lookup hints
// output: Index of the user message to rewind to, or -1
// pos: Pure resolver for in-place rewind when UI/server message ids diverge

export function resolveRewindMessageIndex(
  messages: Array<{ id: string; role: string; content?: unknown }>,
  userMessageId: string,
  options?: { userOrdinal?: number; content?: string },
): number {
  let messageIndex = messages.findIndex(message => message.id === userMessageId)
  if (messageIndex === -1 && typeof options?.userOrdinal === 'number' && options.userOrdinal >= 0) {
    const userIndexes = messages
      .map((message, index) => (message.role === 'user' ? index : -1))
      .filter(index => index >= 0)
    messageIndex = userIndexes[options.userOrdinal] ?? -1
  }
  if (messageIndex === -1 && typeof options?.content === 'string') {
    const contentMatches = messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === 'user' && message.content === options.content)
    if (contentMatches.length === 1) {
      messageIndex = contentMatches[0]!.index
    }
  }
  return messageIndex
}
