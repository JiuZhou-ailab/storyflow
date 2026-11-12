// input: Previous controlled content, incoming content, and current editor markdown
// output: Regression coverage for TipTap content sync decisions
// pos: Keeps focused document switches from losing externally loaded content

import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'bun:test'
import { getIncomingContentSyncAction } from '../TiptapMarkdownEditor'

describe('getIncomingContentSyncAction', () => {
  it('ignores unchanged controlled content', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# One',
      currentMarkdown: '# One',
    })).toBe('ignore')
  })

  it('records controlled echoes without resetting editor content', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# Two',
      currentMarkdown: '# Two',
    })).toBe('record')
  })

  it('records editor-originated controlled echoes without reading current markdown', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# Two',
      lastEmittedMarkdown: '# Two',
    })).toBe('record')
  })

  it('syncs externally changed content even when it differs from the focused editor markdown', () => {
    expect(getIncomingContentSyncAction({
      previousContent: '# One',
      incomingContent: '# Other file',
      currentMarkdown: '# Unsaved local buffer',
    })).toBe('sync')
  })

  it('checks editor-originated content before serializing current markdown', () => {
    const source = readFileSync(new URL('../TiptapMarkdownEditor.tsx', import.meta.url), 'utf-8')

    expect(source.indexOf('const fastSyncAction = getIncomingContentSyncAction')).toBeLessThan(
      source.indexOf('const currentMd =')
    )
    expect(source).toContain('lastEmittedMarkdownRef')
  })

  it('exposes a dirty signal and explicit markdown snapshot for long documents', () => {
    const source = readFileSync(new URL('../TiptapMarkdownEditor.tsx', import.meta.url), 'utf-8')

    expect(source).toContain('export interface TiptapMarkdownEditorHandle')
    expect(source).toContain('getMarkdownSnapshot(): string')
    expect(source).toContain('onDocumentChanged?: () => void')
    expect(source).toContain('React.useImperativeHandle')
    expect(source).toContain('onDocumentChangedRef.current?.()')
  })

  it('does not emit a user edit while applying external document content', () => {
    const source = readFileSync(new URL('../TiptapMarkdownEditor.tsx', import.meta.url), 'utf-8')

    expect(source).toContain('emitUpdate: false')
    expect(source).toContain('isApplyingExternalContentRef.current || !editor.isFocused')
  })
})


describe('document synchronization acknowledgement', () => {
  const source = readFileSync(new URL('../TiptapMarkdownEditor.tsx', import.meta.url), 'utf8')
  const file = ts.createSourceFile('Editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effectSource = ''
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'React.useEffect'
      && node.arguments[0]?.getText(file).includes('const acknowledgeContent')) effectSource = node.arguments[0].getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  const js = ts.transpileModule(`const effect = ${effectSource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  function sync(options: { fail?: boolean; same?: boolean; absent?: boolean } = {}) {
    const events: unknown[] = []
    let prose = options.same ? '# New' : '# Old'
    const env = {
      editor: options.absent ? null : { commands: {
        setContent: (text: string) => { if (options.fail) throw new Error('parse failed'); prose = text; events.push('setContent') },
        clearHistory: () => {},
      } },
      content: '# New', contentIdentity: '/new.md',
      prevContentRef: { current: options.same ? '# New' : '# Old' },
      lastEmittedMarkdownRef: { current: null }, isApplyingExternalContentRef: { current: false }, hasLocalEditsRef: { current: false },
      setSyncedContent: (value: unknown) => { events.push({ acknowledgement: value, prose }) },
      getIncomingContentSyncAction, getOfficialMarkdown: () => prose,
      postprocessMarkdownFromOfficial: (value: string) => value, preprocessMarkdownForOfficial: (value: string) => value,
      queueMicrotask: () => {},
    }
    const run = new Function(...Object.keys(env), `${js}; return effect`)(...Object.values(env))
    return { events, run }
  }
  it('acknowledges a new identity only after setContent applies its body', () => {
    const { events, run } = sync()
    expect(events).toEqual([])
    run()
    expect(events).toEqual(['setContent', { acknowledgement: { identity: '/new.md', content: '# New' }, prose: '# New' }])
  })
  it('does not acknowledge failed parsing or an editor that is not created yet', () => {
    const failed = sync({ fail: true })
    expect(failed.run).toThrow('parse failed')
    expect(failed.run).toThrow('parse failed') // A retry must not acknowledge the old prose.
    expect(failed.events).toEqual([])
    const absent = sync({ absent: true })
    absent.run()
    expect(absent.events).toEqual([])
  })
  it('can acknowledge an identical body belonging to a new file without resetting the editor', () => {
    const { events, run } = sync({ same: true })
    run()
    expect(events).toEqual([{ acknowledgement: { identity: '/new.md', content: '# New' }, prose: '# New' }])
  })
})
