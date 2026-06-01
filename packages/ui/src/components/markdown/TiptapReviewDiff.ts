// input: Previous and current ProseMirror documents for a TipTap editor
// output: Review diff ranges and decorations rendered in the editor document
// pos: ProseMirror-native review layer for writing surfaces

import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ChangeSet, simplifyChanges } from '@tiptap/pm/changeset'
import { Transform } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface TiptapReviewDiffRange {
  id: string
  kind: 'insert' | 'delete' | 'replace'
  fromA: number
  toA: number
  fromB: number
  toB: number
  deletedText: string
  insertedText: string
}

interface TiptapReviewDiffPluginState {
  previousDoc: ProseMirrorNode | null
  ranges: TiptapReviewDiffRange[]
}

export const TIPTAP_REVIEW_DIFF_KEY = new PluginKey<TiptapReviewDiffPluginState>('tiptapReviewDiff')

export function buildTiptapReviewDiffRanges(
  previousDoc: ProseMirrorNode,
  currentDoc: ProseMirrorNode,
): TiptapReviewDiffRange[] {
  if (previousDoc.eq(currentDoc)) return []

  const transform = new Transform(previousDoc)
  transform.replaceWith(0, previousDoc.content.size, currentDoc.content)

  const changeSet = ChangeSet.create(previousDoc).addSteps(
    transform.doc,
    transform.mapping.maps,
    'review',
  )
  const changes = simplifyChanges(changeSet.changes, currentDoc)

  return changes.map((change, index) => {
    const hasDelete = change.fromA < change.toA
    const hasInsert = change.fromB < change.toB

    return {
      id: `review-diff-${index}:${change.fromA}-${change.toA}:${change.fromB}-${change.toB}`,
      kind: hasDelete && hasInsert ? 'replace' : hasDelete ? 'delete' : 'insert',
      fromA: change.fromA,
      toA: change.toA,
      fromB: change.fromB,
      toB: change.toB,
      deletedText: hasDelete ? previousDoc.textBetween(change.fromA, change.toA, '\n\n') : '',
      insertedText: hasInsert ? currentDoc.textBetween(change.fromB, change.toB, '\n\n') : '',
    }
  })
}

function buildInsertDecorations(doc: ProseMirrorNode, range: TiptapReviewDiffRange): Decoration[] {
  if (range.fromB >= range.toB) return []

  const decorations: Decoration[] = []
  doc.nodesBetween(range.fromB, range.toB, (node, pos, parent) => {
    const from = Math.max(range.fromB, pos)
    const to = Math.min(range.toB, pos + node.nodeSize)

    if (parent === doc && from === pos && to === pos + node.nodeSize && !node.isText) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {
        class: 'tiptap-review-diff-block tiptap-review-diff-inserted',
      }))
      return false
    }

    if (node.isText && from < to) {
      decorations.push(Decoration.inline(from, to, {
        class: 'tiptap-review-diff-inserted',
      }))
    }

    return true
  })

  return decorations
}

function createDeletedWidget(range: TiptapReviewDiffRange): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'tiptap-review-diff-deleted'
  wrapper.dataset.reviewDiffId = range.id
  wrapper.textContent = range.deletedText || 'Deleted content'
  return wrapper
}

function buildReviewDecorations(doc: ProseMirrorNode, ranges: TiptapReviewDiffRange[]): DecorationSet {
  const decorations: Decoration[] = []

  for (const range of ranges) {
    if (range.kind === 'insert' || range.kind === 'replace') {
      decorations.push(...buildInsertDecorations(doc, range))
    }

    if (range.kind === 'delete' || range.kind === 'replace') {
      decorations.push(Decoration.widget(
        Math.max(0, Math.min(range.fromB, doc.content.size)),
        () => createDeletedWidget(range),
        { key: `deleted:${range.id}`, side: -1 },
      ))
    }
  }

  return decorations.length > 0
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty
}

function createReviewDiffState(previousDoc: ProseMirrorNode | null, currentDoc: ProseMirrorNode): TiptapReviewDiffPluginState {
  return {
    previousDoc,
    ranges: previousDoc ? buildTiptapReviewDiffRanges(previousDoc, currentDoc) : [],
  }
}

export const TiptapReviewDiff = Extension.create({
  name: 'tiptapReviewDiff',

  addProseMirrorPlugins() {
    return [
      new Plugin<TiptapReviewDiffPluginState>({
        key: TIPTAP_REVIEW_DIFF_KEY,
        state: {
          init: (_config, state) => createReviewDiffState(null, state.doc),
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(TIPTAP_REVIEW_DIFF_KEY) as { previousDoc?: ProseMirrorNode | null } | undefined
            if (Object.prototype.hasOwnProperty.call(meta ?? {}, 'previousDoc')) {
              return createReviewDiffState(meta?.previousDoc ?? null, newState.doc)
            }

            if (tr.docChanged && previous.previousDoc) {
              return createReviewDiffState(previous.previousDoc, newState.doc)
            }

            return previous
          },
        },
        props: {
          decorations(state) {
            const pluginState = TIPTAP_REVIEW_DIFF_KEY.getState(state)
            if (!pluginState || pluginState.ranges.length === 0) return DecorationSet.empty
            return buildReviewDecorations(state.doc, pluginState.ranges)
          },
        },
      }),
    ]
  },
})
