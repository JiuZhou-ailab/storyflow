// input: Epoch timestamps
// output: Chinese relative-time labels
// pos: Tiny display helpers shared by project manager and workspace create forms

/** Relative activity label for list rows (zh). */
export function formatRelativeTimestamp(at: number | undefined, empty = '未打开过'): string {
  if (typeof at !== 'number') return empty
  const delta = Date.now() - at
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`
  try {
    return new Date(at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return '更早'
  }
}
