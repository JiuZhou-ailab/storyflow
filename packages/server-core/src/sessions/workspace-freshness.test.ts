import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WorkspaceFreshness } from './workspace-freshness'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function project() {
  root = mkdtempSync(join(tmpdir(), 'workspace-freshness-'))
  mkdirSync(join(root, 'chapters'))
  writeFileSync(join(root, 'chapters', 'one.md'), 'one')
  writeFileSync(join(root, 'notes.txt'), 'notes')
  writeFileSync(join(root, 'cover.png'), 'binary')
  return root
}

const touch = (path: string, content: string) => {
  writeFileSync(path, content)
  // Same-millisecond writes would otherwise keep the signature when the size matches.
  utimesSync(path, new Date(), new Date(Date.now() + 5_000))
}

describe('WorkspaceFreshness', () => {
  it('reports only changes made after the turn that just ended', async () => {
    const freshness = new WorkspaceFreshness()
    project()
    expect(await freshness.brief('s', root)).toBeUndefined()

    // The agent's own edits land before the turn-end checkpoint.
    touch(join(root, 'chapters', 'one.md'), 'agent rewrite')
    await freshness.checkpoint('s', root)
    expect(await freshness.brief('s', root)).toBeUndefined()

    touch(join(root, 'notes.txt'), 'user')
    rmSync(join(root, 'chapters', 'one.md'))
    writeFileSync(join(root, 'chapters', 'two.md'), 'two')
    writeFileSync(join(root, 'cover.png'), 'other binary')
    await freshness.checkpoint('other-session', root)
    const brief = await freshness.brief('s', root)
    expect(brief).toBe([
      '<workspace-brief>',
      'Workspace files changed since your last turn in this session:',
      '- chapters/one.md deleted',
      '- chapters/two.md added',
      '- notes.txt modified',
      '</workspace-brief>',
    ].join('\n'))
    expect(await freshness.brief('s', root)).toBeUndefined()
  })

  it('skips the brief instead of failing when the project cannot be read', async () => {
    const freshness = new WorkspaceFreshness()
    project()
    await freshness.brief('s', root)
    rmSync(root, { recursive: true, force: true })
    expect(await freshness.brief('s', root)).toBeUndefined()
    project()
    // The failed capture dropped the baseline, so the next send starts over quietly.
    expect(await freshness.brief('s', root)).toBeUndefined()
  })
})
