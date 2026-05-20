// input: TipTap editor selections and optional selection-AI callbacks
// output: Floating formatting, rich block editing, math editing, and selection-AI menus
// pos: Shared BubbleMenu layer for Markdown editing surfaces

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Bold, Italic, Loader2, MessageSquarePlus, SendHorizontal, Strikethrough, Code, Sigma } from 'lucide-react'
import { cn } from '../../lib/utils'
import { RICH_BLOCK_EDIT_EVENT } from './rich-block-events'

// Custom event name used to signal "open inline math editor"
const INLINE_MATH_EDIT_EVENT = 'inlineMathEdit'

export interface TiptapSelectionAiRequest {
  selectedText: string
  instruction: string
}

export interface TiptapSelectionChatRequest {
  selectedText: string
}

type SelectionAiRangeHighlightState = {
  range: { from: number; to: number } | null
}

export const SELECTION_AI_RANGE_HIGHLIGHT_KEY = new PluginKey<SelectionAiRangeHighlightState>('selectionAiRangeHighlight')

export function setSelectionAiRangeHighlight(editor: Editor, range: SelectionAiRangeHighlightState['range']) {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(SELECTION_AI_RANGE_HIGHLIGHT_KEY, { range }))
}

export const SelectionAiRangeHighlight = Extension.create({
  name: 'selectionAiRangeHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<SelectionAiRangeHighlightState>({
        key: SELECTION_AI_RANGE_HIGHLIGHT_KEY,
        state: {
          init: () => ({ range: null }),
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(SELECTION_AI_RANGE_HIGHLIGHT_KEY) as Partial<SelectionAiRangeHighlightState> | undefined
            let range = Object.prototype.hasOwnProperty.call(meta ?? {}, 'range')
              ? meta?.range ?? null
              : previous.range

            if (range && tr.docChanged) {
              range = {
                from: tr.mapping.map(range.from, -1),
                to: tr.mapping.map(range.to, 1),
              }
            }

            if (!range || range.from >= range.to || range.from < 0 || range.to > newState.doc.content.size) {
              return { range: null }
            }

            return { range }
          },
        },
        props: {
          decorations(state) {
            const range = SELECTION_AI_RANGE_HIGHLIGHT_KEY.getState(state)?.range
            if (!range) return DecorationSet.empty

            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: 'selection-ai-range-highlight' }),
            ])
          },
        },
      }),
    ]
  },
})

// ============================================================================
// Bubble menu toolbar button
// ============================================================================

function BubbleButton({
  onClick,
  isActive,
  title,
  children,
}: {
  onClick: () => void
  isActive?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      title={title}
      className={cn(
        'tiptap-bubble-btn',
        isActive && 'is-active',
      )}
    >
      {children}
    </button>
  )
}

// ============================================================================
// Text formatting bubble menu — Bold, Italic, Strike, Code
// ============================================================================

function getSelectedText(editor: Editor): string {
  const { from, to } = editor.state.selection
  return editor.state.doc.textBetween(from, to, '\n\n')
}

function TextFormattingMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation()

  return (
    <div className="tiptap-bubble-menu">
      <BubbleButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title={t('editor.bold')}
      >
        <Bold className="w-3.5 h-3.5" />
      </BubbleButton>

      <BubbleButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title={t('editor.italic')}
      >
        <Italic className="w-3.5 h-3.5" />
      </BubbleButton>

      <BubbleButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title={t('editor.strikethrough')}
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </BubbleButton>

      <BubbleButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive('code')}
        title={t('editor.code')}
      >
        <Code className="w-3.5 h-3.5" />
      </BubbleButton>

      <BubbleButton
        onClick={() => {
          const { from, to } = editor.state.selection
          const selectedText = editor.state.doc.textBetween(from, to)
          // Delete selected text, then insert inlineMath node with that text as latex
          editor.chain().focus()
            .deleteSelection()
            .insertInlineMath({ latex: selectedText })
            .run()
          // Open the edit popover on the newly created node
          const newPos = editor.state.selection.from - 1
          const node = editor.state.doc.nodeAt(newPos)
          if (node?.type.name === 'inlineMath') {
            editor.chain().setNodeSelection(newPos).run()
            queueMicrotask(() => (editor as any).emit(INLINE_MATH_EDIT_EVENT))
          }
        }}
        title={t('editor.math')}
      >
        <Sigma className="w-3.5 h-3.5" />
      </BubbleButton>
    </div>
  )
}

function SelectionAiPrompt({
  editor,
  onAskAiForSelection,
  onAddSelectionToChat,
}: {
  editor: Editor
  onAskAiForSelection: (request: TiptapSelectionAiRequest) => Promise<string>
  onAddSelectionToChat?: (request: TiptapSelectionChatRequest) => void
}) {
  const { t } = useTranslation()
  const [selectionPrompt, setSelectionPrompt] = React.useState('')
  const [selectedText, setSelectedText] = React.useState('')
  const [selectionRange, setSelectionRange] = React.useState<{ from: number; to: number } | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const syncSelectedText = React.useCallback(() => {
    const { selection } = editor.state
    if (selection.from === selection.to || selection instanceof NodeSelection || editor.isActive('codeBlock')) {
      if (document.activeElement === inputRef.current) return
      setSelectedText('')
      setSelectionRange(null)
      setSelectionPrompt('')
      setSelectionAiRangeHighlight(editor, null)
      return
    }

    setSelectedText(getSelectedText(editor))
    setSelectionRange({ from: selection.from, to: selection.to })
    setSelectionAiRangeHighlight(editor, { from: selection.from, to: selection.to })
    setSelectionPrompt('')
  }, [editor])

  const clearSelectionPrompt = React.useCallback(() => {
    setSelectionPrompt('')
  }, [])

  const submitSelectionPrompt = React.useCallback(async () => {
    const instruction = selectionPrompt.trim()
    if (!instruction || !selectedText.trim() || !selectionRange || isSubmitting) return

    setIsSubmitting(true)
    try {
      const replacement = await onAskAiForSelection({ selectedText, instruction })
      editor
        .chain()
        .focus()
        .insertContentAt({ from: selectionRange.from, to: selectionRange.to }, replacement, { contentType: 'markdown' } as never)
        .run()
      clearSelectionPrompt()
      setSelectedText('')
      setSelectionRange(null)
      setSelectionAiRangeHighlight(editor, null)
    } catch (error) {
      console.error('[SelectionAiPrompt] Failed to rewrite selection:', error)
    } finally {
      setIsSubmitting(false)
      requestAnimationFrame(() => editor.chain().focus().run())
    }
  }, [clearSelectionPrompt, editor, isSubmitting, onAskAiForSelection, selectedText, selectionPrompt, selectionRange])

  const addSelectionToChat = React.useCallback(() => {
    if (!selectedText.trim() || !selectionRange) return
    onAddSelectionToChat?.({ selectedText })
    clearSelectionPrompt()
    setSelectionAiRangeHighlight(editor, null)
    requestAnimationFrame(() => editor.chain().focus().run())
  }, [clearSelectionPrompt, editor, onAddSelectionToChat, selectedText, selectionRange])

  React.useEffect(() => {
    syncSelectedText()

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      if (!editor.isDestroyed) {
        const tr = editor.state.tr.setMeta('selectionAiPrompt', 'updatePosition')
        editor.view.dispatch(tr)
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [editor, syncSelectedText])

  React.useEffect(() => {
    return () => setSelectionAiRangeHighlight(editor, null)
  }, [editor])

  React.useEffect(() => {
    editor.on('selectionUpdate', syncSelectedText)
    return () => {
      editor.off('selectionUpdate', syncSelectedText)
    }
  }, [editor, syncSelectedText])

  return (
    <div className="tiptap-bubble-menu tiptap-bubble-menu--selection-ai">
      <input
        ref={inputRef}
        type="text"
        value={selectionPrompt}
        onChange={(event) => setSelectionPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            void submitSelectionPrompt()
            return
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            clearSelectionPrompt()
            setSelectionAiRangeHighlight(editor, null)
            requestAnimationFrame(() => editor.chain().focus().run())
            return
          }

          event.stopPropagation()
        }}
        onMouseDown={(event) => {
          event.stopPropagation()
          if (document.activeElement !== inputRef.current) {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
        placeholder={t('editor.askAiPlaceholder', 'Tell AI what to change')}
        className="tiptap-bubble-ai-input"
        disabled={isSubmitting}
      />
      <button
        type="button"
        className="tiptap-bubble-ai-send-btn"
        title={t('editor.askAiSend', 'Send')}
        disabled={isSubmitting || !selectionPrompt.trim() || !selectedText.trim() || !selectionRange}
        onClick={() => { void submitSelectionPrompt() }}
        onMouseDown={(event) => event.preventDefault()}
      >
        {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SendHorizontal className="w-3.5 h-3.5" />}
      </button>
      {onAddSelectionToChat ? (
        <button
          type="button"
          className="tiptap-bubble-ai-send-btn"
          title={t('editor.addSelectionToChat', 'Add selection to chat')}
          disabled={isSubmitting || !selectedText.trim() || !selectionRange}
          onClick={addSelectionToChat}
          onMouseDown={(event) => event.preventDefault()}
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  )
}

// ============================================================================
// Code block edit bubble menu — edit popover for mermaid / latex blocks
// ============================================================================

const VISUAL_LANGUAGES = new Set(['mermaid', 'latex', 'math', 'tex', 'katex'])

function getEditableBlockMeta(editor: Editor): { label: string; code: string; update: (next: string) => void } | null {
  const { selection } = editor.state

  if (selection instanceof NodeSelection) {
    const node = selection.node
    const pos = selection.from

    if (node.type.name === 'mermaidBlock') {
      return {
        label: 'Mermaid',
        code: String(node.attrs.code ?? ''),
        update: (next) => {
          editor.chain().focus().setNodeSelection(pos).updateAttributes('mermaidBlock', { code: next }).run()
        },
      }
    }

    if (node.type.name === 'latexBlock') {
      return {
        label: 'LaTeX',
        code: String(node.attrs.code ?? ''),
        update: (next) => {
          editor.chain().focus().setNodeSelection(pos).updateAttributes('latexBlock', { code: next }).run()
        },
      }
    }

    return null
  }

  // Legacy fallback while old docs/code paths still contain codeBlock language variants.
  const { $from } = selection
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name !== 'codeBlock') continue

    const lang = (node.attrs.language as string | undefined)?.toLowerCase() ?? ''
    if (!VISUAL_LANGUAGES.has(lang)) return null

    const label = lang === 'mermaid' ? 'Mermaid' : 'LaTeX'
    const pos = $from.before(depth)

    return {
      label,
      code: node.textContent,
      update: (next) => {
        const tr = editor.state.tr.replaceWith(
          pos + 1,
          pos + node.nodeSize - 1,
          next.length > 0 ? editor.schema.text(next) : editor.schema.text(' '),
        )
        editor.view.dispatch(tr)
      },
    }
  }

  return null
}

function RichBlockEditMenu({ editor }: { editor: Editor }) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [positionReady, setPositionReady] = React.useState(false)
  const [code, setCode] = React.useState('')
  const [label, setLabel] = React.useState('Block')
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const openEditor = React.useCallback(() => {
    const meta = getEditableBlockMeta(editor)
    if (!meta) return
    setLabel(meta.label)
    setCode(meta.code)
    setPositionReady(false)
    setIsEditing(true)
  }, [editor])

  React.useEffect(() => {
    const activate = () => {
      openEditor()
    }
    ;(editor as any).on(RICH_BLOCK_EDIT_EVENT, activate)
    return () => { (editor as any).off(RICH_BLOCK_EDIT_EVENT, activate) }
  }, [editor, openEditor])

  const commitEdit = React.useCallback(() => {
    const meta = getEditableBlockMeta(editor)
    if (!meta) {
      setPositionReady(false)
      setIsEditing(false)
      return
    }

    meta.update(code)
    setPositionReady(false)
    setIsEditing(false)
  }, [editor, code])

  React.useEffect(() => {
    if (!isEditing) return

    const syncOrClose = () => {
      const meta = getEditableBlockMeta(editor)
      if (!meta) {
        setPositionReady(false)
        setIsEditing(false)
        return
      }
      setLabel(meta.label)
    }

    editor.on('selectionUpdate', syncOrClose)
    return () => {
      editor.off('selectionUpdate', syncOrClose)
    }
  }, [editor, isEditing])

  // Auto-resize textarea
  React.useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      const el = textareaRef.current
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`

      // Content height changes after first render; force BubbleMenu to recalculate.
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        const tr = editor.state.tr.setMeta('richBlockEdit', 'updatePositionAfterResize')
        editor.view.dispatch(tr)
      })
    }
  }, [editor, isEditing, code])

  // BubbleMenu positions on ProseMirror transactions/resize, not React-only state changes.
  // Opening edit mode changes popover content size/anchor context, so force re-position.
  React.useEffect(() => {
    if (!isEditing) return

    let raf2: number | null = null
    let raf3: number | null = null
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const tr = editor.state.tr.setMeta('richBlockEdit', 'updatePosition')
        editor.view.dispatch(tr)

        // Reveal on the next frame so floating-ui has applied computed position.
        raf3 = requestAnimationFrame(() => {
          setPositionReady(true)
        })
      })
    })

    return () => {
      cancelAnimationFrame(raf1)
      if (raf2 != null) cancelAnimationFrame(raf2)
      if (raf3 != null) cancelAnimationFrame(raf3)
    }
  }, [editor, isEditing])

  if (!isEditing) {
    return null
  }

  return (
    <div
      className="tiptap-bubble-menu tiptap-bubble-menu--editing"
      style={!positionReady ? { opacity: 0, pointerEvents: 'none' } : undefined}
    >
      <div className="tiptap-bubble-edit-header">
        <span className="tiptap-bubble-label tiptap-bubble-panel-title">{label}</span>
        <button
          type="button"
          className="tiptap-bubble-done-btn"
          onClick={commitEdit}
        >
          Done
        </button>
      </div>
      <div className="tiptap-bubble-textarea-shell">
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              commitEdit()
            }
            e.stopPropagation()
          }}
          className="tiptap-bubble-textarea"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

// ============================================================================
// Inline math edit menu — edit popover for $...$ math nodes
// ============================================================================

function InlineMathEditMenu({ editor }: { editor: Editor }) {
  const [editActive, setEditActive] = React.useState(false)
  const [latex, setLatex] = React.useState('')
  const [nodePos, setNodePos] = React.useState<number | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Listen for the custom "activate edit" event (fired by click handler and Enter key handler)
  React.useEffect(() => {
    const activate = () => {
      setEditActive(true)
      // Sync latex value from the current selection
      const { selection } = editor.state
      if (selection instanceof NodeSelection && selection.node.type.name === 'inlineMath') {
        setLatex(selection.node.attrs.latex as string)
        setNodePos(selection.from)
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => inputRef.current?.focus())
      })
    }
    ;(editor as any).on(INLINE_MATH_EDIT_EVENT, activate)
    return () => { (editor as any).off(INLINE_MATH_EDIT_EVENT, activate) }
  }, [editor])

  // Also sync latex/nodePos on selectionUpdate when active (e.g. if doc changes around the node)
  React.useEffect(() => {
    if (!editActive) return
    const sync = () => {
      const { selection } = editor.state
      if (selection instanceof NodeSelection && selection.node.type.name === 'inlineMath') {
        setNodePos(selection.from)
      }
    }
    editor.on('selectionUpdate', sync)
    return () => { editor.off('selectionUpdate', sync) }
  }, [editor, editActive])

  const deactivateAndMove = React.useCallback((targetPos: number) => {
    setEditActive(false)
    editor.chain().focus().setTextSelection(targetPos).run()
  }, [editor])

  const commitEdit = React.useCallback(() => {
    if (nodePos == null) return
    setEditActive(false)
    if (latex.trim().length === 0) {
      editor.chain().focus().deleteInlineMath({ pos: nodePos }).run()
    } else {
      const node = editor.state.doc.nodeAt(nodePos)
      const afterPos = node ? nodePos + node.nodeSize : nodePos + 1
      editor.chain().focus().updateInlineMath({ latex, pos: nodePos }).setTextSelection(afterPos).run()
    }
  }, [editor, latex, nodePos])

  return (
    <div
      className="tiptap-bubble-menu tiptap-bubble-menu--inline-math"
      style={!editActive ? { opacity: 0, pointerEvents: 'none' } : undefined}
    >
      <input
        ref={inputRef}
        type="text"
        value={latex}
        onChange={(e) => setLatex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitEdit()
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            if (nodePos != null) {
              const node = editor.state.doc.nodeAt(nodePos)
              const afterPos = node ? nodePos + node.nodeSize : nodePos + 1
              deactivateAndMove(afterPos)
            }
            return
          }
          // Arrow left at start of input → commit and place cursor before the node
          if (e.key === 'ArrowLeft' && inputRef.current?.selectionStart === 0) {
            e.preventDefault()
            if (nodePos != null && latex.trim().length > 0) {
              setEditActive(false)
              editor.chain().focus().updateInlineMath({ latex, pos: nodePos }).setTextSelection(nodePos).run()
            } else if (nodePos != null) {
              const node = editor.state.doc.nodeAt(nodePos)
              const afterPos = node ? nodePos + node.nodeSize : nodePos + 1
              deactivateAndMove(afterPos)
            }
            return
          }
          // Arrow right at end of input → commit and place cursor after the node
          if (e.key === 'ArrowRight' && inputRef.current?.selectionStart === latex.length) {
            e.preventDefault()
            commitEdit()
            return
          }
          e.stopPropagation()
        }}
        onBlur={commitEdit}
        className="tiptap-bubble-math-input"
        spellCheck={false}
      />
    </div>
  )
}

// ============================================================================
// Exported composite: all bubble menus for the TipTap editor
// ============================================================================

export { INLINE_MATH_EDIT_EVENT }

const TIPTAP_BUBBLE_MENU_Z_INDEX = 'var(--z-floating-menu, 400)'
const TIPTAP_BUBBLE_MENU_BASE_OPTIONS = {
  // Keep default positioning strategy/portal behavior.
  // `fixed + appendTo(body)` can drift in nested/animated layouts on first show.
  zIndex: TIPTAP_BUBBLE_MENU_Z_INDEX,
}

export function TiptapBubbleMenus({
  editor,
  onAskAiForSelection,
  onAddSelectionToChat,
}: {
  editor: Editor
  onAskAiForSelection?: (request: TiptapSelectionAiRequest) => Promise<string>
  onAddSelectionToChat?: (request: TiptapSelectionChatRequest) => void
}) {
  const getRichBlockEditAnchor = React.useCallback(() => {
    const { selection } = editor.state
    if (!(selection instanceof NodeSelection)) return null

    const name = selection.node.type.name
    if (name !== 'mermaidBlock' && name !== 'latexBlock') return null

    const getRect = () => {
      // Preferred path: edit button bounds inside selected node DOM.
      const selectedNodeDom = editor.view.nodeDOM(selection.from)
      if (selectedNodeDom instanceof HTMLElement) {
        const selectedButton = selectedNodeDom.querySelector('.rich-block-edit-button')
        if (selectedButton instanceof HTMLElement) {
          return selectedButton.getBoundingClientRect()
        }

        // Fallback: selected node wrapper rect.
        const nodeRect = selectedNodeDom.getBoundingClientRect()
        if (nodeRect.width > 0 && nodeRect.height > 0) {
          return nodeRect
        }
      }

      // Final fallback: ProseMirror coords (always available once the selection exists).
      // Use a tiny virtual rect near the top-left of the node as deterministic anchor.
      const coords = editor.view.coordsAtPos(selection.from)
      return new DOMRect(coords.left, coords.top, 1, 1)
    }

    return {
      getBoundingClientRect: getRect,
      getClientRects: () => [getRect()],
    }
  }, [editor])

  return (
    <>
      {/* Text formatting — shows on text selection, hidden in code blocks */}
      <BubbleMenu
        editor={editor}
        pluginKey="textFormatting"
        updateDelay={0}
        shouldShow={({ editor: e, state }) => {
          const { selection } = state
          if (selection.from === selection.to) return false
          if (selection instanceof NodeSelection) return false
          if (e.isActive('codeBlock')) return false
          return true
        }}
        options={{ ...TIPTAP_BUBBLE_MENU_BASE_OPTIONS, placement: 'top', offset: 8 }}
      >
        <TextFormattingMenu editor={editor} />
      </BubbleMenu>

      {onAskAiForSelection ? (
        <BubbleMenu
          editor={editor}
          pluginKey="selectionAiPrompt"
          updateDelay={0}
          shouldShow={({ editor: e, state }) => {
            const { selection } = state
            if (selection.from === selection.to) return false
            if (selection instanceof NodeSelection) return false
            if (e.isActive('codeBlock')) return false
            return true
          }}
          options={{ ...TIPTAP_BUBBLE_MENU_BASE_OPTIONS, placement: 'bottom-start', offset: 8 }}
        >
          <SelectionAiPrompt
            editor={editor}
            onAskAiForSelection={onAskAiForSelection}
            onAddSelectionToChat={onAddSelectionToChat}
          />
        </BubbleMenu>
      ) : null}

      {/* Rich block edit — shows for selected Mermaid/LaTeX rich blocks (and legacy codeBlock fallback). */}
      <BubbleMenu
        editor={editor}
        pluginKey="richBlockEdit"
        updateDelay={0}
        shouldShow={({ state, editor: e }) => {
          if (state.selection instanceof NodeSelection) {
            const name = state.selection.node.type.name
            if (name === 'mermaidBlock' || name === 'latexBlock') return true
          }

          if (!e.isActive('codeBlock')) return false
          const lang = (e.getAttributes('codeBlock').language as string | undefined)?.toLowerCase()
          return lang != null && VISUAL_LANGUAGES.has(lang)
        }}
        getReferencedVirtualElement={getRichBlockEditAnchor}
        options={{
          ...TIPTAP_BUBBLE_MENU_BASE_OPTIONS,
          placement: 'left-start',
          offset: { mainAxis: 8, crossAxis: 0 },
          shift: false,
          flip: false,
        }}
      >
        <RichBlockEditMenu editor={editor} />
      </BubbleMenu>

      {/* Inline math edit — always mounted when inlineMath selected; content visibility controlled by InlineMathEditMenu */}
      <BubbleMenu
        editor={editor}
        pluginKey="inlineMathEdit"
        updateDelay={0}
        shouldShow={({ state }) => {
          const { selection } = state
          return selection instanceof NodeSelection && selection.node.type.name === 'inlineMath'
        }}
        options={{ ...TIPTAP_BUBBLE_MENU_BASE_OPTIONS, placement: 'top', offset: 8 }}
      >
        <InlineMathEditMenu editor={editor} />
      </BubbleMenu>
    </>
  )
}
