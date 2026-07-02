// input: JSON code-fence payloads for markdown-preview blocks
// output: Parsed markdown preview specs and normalized preview item lists
// pos: Pure helper layer for markdown preview parsing, independent of renderer UI

export interface MarkdownPreviewItem {
  src: string
  label?: string
}

export interface MarkdownPreviewSpec {
  src?: string
  title?: string
  items?: MarkdownPreviewItem[]
}

export function parseMarkdownPreviewSpec(code: string): MarkdownPreviewSpec | null {
  let raw: unknown
  try {
    raw = JSON.parse(code)
  } catch {
    return null
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const spec = raw as Record<string, unknown>
  const title = typeof spec.title === 'string' ? spec.title : undefined

  if (Array.isArray(spec.items) && spec.items.length > 0) {
    const items = spec.items.filter(
      (item): item is MarkdownPreviewItem =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as { src?: unknown }).src === 'string' &&
        (item as { src: string }).src.length > 0,
    )
    if (items.length === 0) return null
    return {
      src: typeof spec.src === 'string' ? spec.src : undefined,
      title,
      items,
    }
  }

  if (typeof spec.src === 'string' && spec.src.length > 0) {
    return { src: spec.src, title }
  }

  return null
}

export function normalizePreviewItems(spec: MarkdownPreviewSpec | null): MarkdownPreviewItem[] {
  if (!spec) return []
  if (spec.items && spec.items.length > 0) return spec.items
  if (spec.src) return [{ src: spec.src }]
  return []
}
