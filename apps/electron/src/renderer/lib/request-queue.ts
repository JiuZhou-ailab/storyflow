export function appendUniqueRequestById<T extends { requestId: string }>(queue: T[], request: T): T[] {
  if (queue.some(item => item.requestId === request.requestId)) return queue
  return [...queue, request]
}
