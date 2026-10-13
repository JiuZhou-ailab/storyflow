import { beforeAll, describe, expect, it, mock } from 'bun:test'
import i18n from 'i18next'
import { tableToMarkdown, tableToCsv, xmlEscape, buildSheetXml, buildXlsxBlob, tableToXlsx, runTableExport } from '../table-export'

beforeAll(async () => {
  if (i18n.isInitialized) return
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          'table.booleanYes': 'Yes',
          'table.booleanNo': 'No',
          'table.exportDownloaded': 'Download started',
          'table.exportFailed': 'Failed to export table',
          'toast.copied': 'Copied to clipboard',
          'toast.copyFailed': 'Failed to copy',
        },
      },
      'zh-Hans': {
        translation: {
          'table.booleanYes': '是',
          'table.booleanNo': '否',
        },
      },
    },
    interpolation: { escapeValue: false },
    initImmediate: false,
  })
})

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'note', label: 'Note' },
  { key: 'on', label: 'On', type: 'boolean' },
]

describe('tableToMarkdown', () => {
  it('turns newlines into <br> and escapes backslash before pipe', () => {
    const md = tableToMarkdown(
      [{ key: 'a', label: 'A' }],
      [{ a: 'line1\r\nline2\nline3' }, { a: 'keep \\| literal | cell' }],
    )
    expect(md).toContain('| line1<br>line2<br>line3 |')
    // source "\|" becomes "\\\|" in the cell: backslash escaped, then the pipe
    expect(md).toContain('| keep \\\\\\| literal \\| cell |')
    expect(md.split('\n')).toHaveLength(4)
  })
})

describe('tableToCsv', () => {
  it('still quotes fields that contain newlines', () => {
    const csv = tableToCsv([{ key: 'a', label: 'A' }], [{ a: 'x\ny' }])
    expect(csv).toBe('A\r\n"x\ny"')
  })
})

describe('xlsx xml', () => {
  it('strips XML 1.0 illegal characters and keeps tab, newline, carriage return', () => {
    const loneHigh = '\uD800'
    const input = `ok\t\n\r\u0000\u0008\u000B\u000C\u000E\u001F${loneHigh}\uFFFE\uFFFF`
    const out = xmlEscape(input)
    expect(out).toBe('ok\t\n\r')
    expect(out).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/)
  })

  it('keeps a valid surrogate pair', () => {
    expect(xmlEscape('😀')).toBe('😀')
  })

  it('escapes markup after stripping controls', () => {
    expect(xmlEscape('a\u0000<b>&')).toBe('a&lt;b&gt;&amp;')
  })

  it('writes boolean cells from i18n', async () => {
    await i18n.changeLanguage('zh-Hans')
    const xml = buildSheetXml(columns, [{ name: 'n', note: 'x\u0001y', on: true }])
    expect(xml).toContain('>是<')
    expect(xml).not.toContain('>Yes<')
    expect(xml).toContain('>xy<')
    await i18n.changeLanguage('en')
    expect(buildSheetXml(columns, [{ name: 'n', note: '', on: false }])).toContain('>No<')
  })
})

describe('tableToXlsx download url', () => {
  it('revokes the object URL on a later turn, not synchronously', () => {
    const revoked: string[] = []
    const anchor = { href: '', download: '', click: () => {} }
    const previousDocument = globalThis.document
    globalThis.document = {
      createElement: () => anchor,
      body: { appendChild: () => anchor, removeChild: () => anchor },
    } as unknown as Document
    const realSetTimeout = globalThis.setTimeout
    const queued: Array<() => void> = []
    globalThis.setTimeout = ((fn: () => void) => {
      queued.push(fn)
      return 0
    }) as typeof setTimeout

    try {
      tableToXlsx([{ key: 'a', label: 'A' }], [{ a: '1' }], 'sheet', {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: (url) => {
          revoked.push(url)
        },
      })
      expect(anchor.download).toBe('sheet.xlsx')
      expect(revoked).toEqual([])
      expect(queued).toHaveLength(1)
      queued[0]!()
      expect(revoked).toEqual(['blob:test'])
    } finally {
      globalThis.setTimeout = realSetTimeout
      globalThis.document = previousDocument
    }
  })
})

describe('runTableExport feedback', () => {
  const messages = {
    copied: 'Copied to clipboard',
    copyFailed: 'Failed to copy',
    downloaded: 'Download started',
    exportFailed: 'Failed to export table',
  }

  it('reports copy success and failure', async () => {
    const success = mock(() => {})
    const error = mock(() => {})
    const copyText = mock(async () => {})
    const cols = [{ key: 'a', label: 'A' }]
    const rows = [{ a: '1' }]

    expect(await runTableExport('markdown', cols, rows, 't', { success, error }, copyText, messages)).toBe(true)
    expect(success).toHaveBeenCalledWith('Copied to clipboard')
    expect(copyText).toHaveBeenCalled()

    copyText.mockImplementationOnce(async () => {
      throw new Error('denied')
    })
    expect(await runTableExport('csv', cols, rows, 't', { success, error }, copyText, messages)).toBe(false)
    expect(error).toHaveBeenCalledWith('Failed to copy')
  })

  it('builds an xlsx blob and reports download failure', async () => {
    const blob = buildXlsxBlob([{ key: 'a', label: 'A' }], [{ a: '1' }])
    expect(blob.size).toBeGreaterThan(0)
    expect(blob.type).toContain('spreadsheetml.sheet')

    const success = mock(() => {})
    const error = mock(() => {})
    const real = Blob
    globalThis.Blob = class extends real {
      constructor() {
        super()
        throw new Error('no blob')
      }
    } as typeof Blob
    try {
      expect(await runTableExport('xlsx', [{ key: 'a', label: 'A' }], [{ a: '1' }], 't', { success, error }, async () => {}, messages)).toBe(false)
      expect(error).toHaveBeenCalledWith('Failed to export table')
      expect(success).not.toHaveBeenCalled()
    } finally {
      globalThis.Blob = real
    }
  })
})
