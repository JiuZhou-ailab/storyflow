import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function makeConfigDir(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-drafts-'))
}

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts, takeDraftsRecovery } from '${STORAGE_MODULE_PATH}'; ${code}`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }

  return run.stdout.toString().trim()
}

describe('session draft storage', () => {
  it('returns null for an unknown session', () => {
    const configDir = makeConfigDir()
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('missing')))")
    expect(output).toBe('null')
  })

  it('round-trips a text-only draft', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: 'hello world' })")
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({ text: 'hello world' })
  })

  it('round-trips a draft with attachment refs', () => {
    const configDir = makeConfigDir()
    runEval(configDir,
      "setSessionDraft('s1', { text: 'caption', attachments: [{ path: '/tmp/a.png', name: 'a.png' }, { path: '/tmp/b.pdf', name: 'Report.pdf' }] })"
    )
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({
      text: 'caption',
      attachments: [
        { path: '/tmp/a.png', name: 'a.png' },
        { path: '/tmp/b.pdf', name: 'Report.pdf' },
      ],
    })
  })

  it('round-trips an attachments-only draft (empty text)', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: '', attachments: [{ path: '/tmp/a.png', name: 'a.png' }] })")
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({
      text: '',
      attachments: [{ path: '/tmp/a.png', name: 'a.png' }],
    })
  })

  it('removes the entry when draft is fully empty', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: 'typed' })")
    runEval(configDir, "setSessionDraft('s1', { text: '' })")
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(output).toBe('null')
  })

  it('strips extra FileAttachment fields when persisting path-only attachments', () => {
    const configDir = makeConfigDir()
    // Pass a FileAttachment-shaped object (includes base64/size/etc.); persistence
    // should reduce it to just path + name when no `content` subfield is present.
    runEval(configDir,
      "setSessionDraft('s1', { text: '', attachments: [{ path: '/tmp/a.png', name: 'a.png', base64: 'AAAA', size: 4, type: 'image', mimeType: 'image/png' }] })"
    )
    const draftsPath = join(configDir, 'drafts.json')
    const raw = JSON.parse(readFileSync(draftsPath, 'utf-8'))
    expect(raw.drafts.s1.attachments).toEqual([{ path: '/tmp/a.png', name: 'a.png' }])
  })

  it('round-trips a draft with a content-backed attachment (paste / web-drag path)', () => {
    const configDir = makeConfigDir()
    runEval(configDir,
      "setSessionDraft('s1', { text: 'note', attachments: [{ path: 'pasted-image-1.png', name: 'pasted-image-1.png', content: { type: 'image', mimeType: 'image/png', size: 4, base64: 'AAAA', thumbnailBase64: 'BBBB' } }] })"
    )
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({
      text: 'note',
      attachments: [{
        path: 'pasted-image-1.png',
        name: 'pasted-image-1.png',
        content: { type: 'image', mimeType: 'image/png', size: 4, base64: 'AAAA', thumbnailBase64: 'BBBB' },
      }],
    })
  })

  it('round-trips a text-content attachment without base64', () => {
    const configDir = makeConfigDir()
    runEval(configDir,
      "setSessionDraft('s1', { text: '', attachments: [{ path: 'pasted.txt', name: 'pasted.txt', content: { type: 'text', mimeType: 'text/plain', size: 5, text: 'hello' } }] })"
    )
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({
      text: '',
      attachments: [{
        path: 'pasted.txt',
        name: 'pasted.txt',
        content: { type: 'text', mimeType: 'text/plain', size: 5, text: 'hello' },
      }],
    })
  })

  it('rejects on load: ref with malformed content (wrong type field)', () => {
    const configDir = makeConfigDir()
    const draftsPath = join(configDir, 'drafts.json')
    writeFileSync(draftsPath, JSON.stringify({
      drafts: {
        s1: {
          text: '',
          attachments: [{ path: 'x.png', name: 'x.png', content: { type: 'bogus', mimeType: 'image/png', size: 1 } }],
        },
      },
      updatedAt: 0,
    }), 'utf-8')
    const output = runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")
    expect(JSON.parse(output)).toEqual({})
  })

  it('rejects on load: 0.8.11-shape ref (synthetic filename path, no content)', () => {
    const configDir = makeConfigDir()
    const draftsPath = join(configDir, 'drafts.json')
    writeFileSync(draftsPath, JSON.stringify({
      drafts: {
        s1: {
          text: 'note',
          attachments: [{ path: 'image.png', name: 'image.png' }],
        },
      },
      updatedAt: 0,
    }), 'utf-8')
    const output = runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")
    // Entire draft is dropped (attachment validator fails → ref fails → draft fails)
    expect(JSON.parse(output)).toEqual({})
  })

  it('discards legacy string-shaped drafts on load', () => {
    const configDir = makeConfigDir()
    // Simulate a pre-upgrade drafts.json where values are strings.
    const draftsPath = join(configDir, 'drafts.json')
    writeFileSync(draftsPath, JSON.stringify({
      drafts: {
        old1: 'unmigrated text',
        old2: 'another one',
      },
      updatedAt: 0,
    }), 'utf-8')
    const output = runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")
    expect(JSON.parse(output)).toEqual({})
  })

  it('keeps valid SessionDraft entries and drops invalid siblings on load', () => {
    const configDir = makeConfigDir()
    const draftsPath = join(configDir, 'drafts.json')
    writeFileSync(draftsPath, JSON.stringify({
      drafts: {
        valid: { text: 'stay' },
        legacy: 'drop',
        mangled: { text: 42 },
      },
      updatedAt: 0,
    }), 'utf-8')
    const output = runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")
    expect(JSON.parse(output)).toEqual({ valid: { text: 'stay' } })
  })

  it('deleteSessionDraft removes the entry', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: 'hi' })")
    runEval(configDir, "deleteSessionDraft('s1')")
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(output).toBe('null')
  })

  it.each([
    ['invalid JSON', '{"drafts":{"s1":{"text":"long unsaved paragraph"}'],
    ['drafts that are not an object', '{"drafts":[{"text":"long unsaved paragraph"}]}'],
    ['a non-object document', '"long unsaved paragraph"'],
  ])('keeps an unreadable drafts file (%s) instead of overwriting it with one draft', (_label, corrupted) => {
    const configDir = makeConfigDir()
    writeFileSync(join(configDir, 'drafts.json'), corrupted)

    runEval(configDir, "setSessionDraft('s2', { text: 'new draft' })")

    const preserved = readdirSync(configDir)
      .filter(name => name.startsWith('drafts.json.corrupt-'))
      .map(name => readFileSync(join(configDir, name), 'utf-8'))
    expect(preserved).toEqual([corrupted])
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s2')))")
    expect(JSON.parse(output)).toEqual({ text: 'new draft' })
  })

  it('preserves an unreadable store on first read and reports its location once', () => {
    const configDir = makeConfigDir()
    const corrupted = '{"drafts":{"s1":{"text":"long unsaved paragraph"}'
    writeFileSync(join(configDir, 'drafts.json'), corrupted)

    const output = runEval(configDir, `
      const drafts = getAllSessionDrafts();
      console.log(JSON.stringify({ drafts, first: takeDraftsRecovery(), second: takeDraftsRecovery() }));
    `)
    const { drafts, first, second } = JSON.parse(output)

    expect(drafts).toEqual({})
    expect(second).toBeNull()
    expect(first.preservedPath.startsWith(join(configDir, 'drafts.json.corrupt-'))).toBe(true)
    expect(readFileSync(first.preservedPath, 'utf-8')).toBe(corrupted)
    expect(readdirSync(configDir)).not.toContain('drafts.json')
  })

  it('reports no recovery for a healthy store', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: 'hello' })")
    const output = runEval(configDir, 'getAllSessionDrafts(); console.log(JSON.stringify(takeDraftsRecovery()))')
    expect(JSON.parse(output)).toBeNull()
  })
})
