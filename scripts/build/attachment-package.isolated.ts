// input: Production attachment storage bundled with locked document converters
// output: PDF dependency selection and immutable document conversion regression coverage
// pos: Real attachment seam isolated from other suites' module mocks
import { expect, test } from 'bun:test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { storeAttachmentFiles } from '../../packages/server-core/src/services/attachment-storage';

// Small, authored PDF with a real cross-reference table and Unicode map. No font
// download or converter mock: the parser must recover each page's actual text.
function pdf(pages: string[]): Buffer<ArrayBuffer> {
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Identity-UCS def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
1 beginbfrange <0000> <FFFF> <0000> endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${7 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R >>',
    stream(cmap),
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>',
  ];
  pages.forEach((text, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${8 + i * 2} 0 R >>`);
    const hex = [...text].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
    objects.push(stream(`BT /F1 12 Tf 50 700 Td <${hex}> Tj ET`));
  });
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  result += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

test('production attachments bundle only the default PDF parser and preserve real PDF originals', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyflow-attachment-package-'));
  try {
    const outfile = join(dir, 'attachments.cjs');
    const bundle = await build({
      entryPoints: [join(import.meta.dir, '../../packages/server-core/src/services/attachment-storage.ts')],
      bundle: true, platform: 'node', format: 'cjs', outfile, metafile: true, external: ['@aws-sdk/client-s3'],
      minifySyntax: true, minifyWhitespace: true, legalComments: 'inline',
    });
    const versions = Object.keys(bundle.metafile!.inputs).filter(path => /pdf-parse.*\/build\/pdf\.js$/.test(path));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toContain('/v1.10.100/');
    const store = (await import(outfile)).storeAttachmentFiles as typeof storeAttachmentFiles;
    for (const pages of [['Hello PDF'], ['First page', 'Second page 中文']]) {
      const bytes = pdf(pages);
      const result = await store({
        attachment: { type: 'pdf', path: 'sample.pdf', name: 'sample.pdf', mimeType: 'application/pdf', size: bytes.length, base64: bytes.toString('base64') },
        attachmentsDir: dir, id: `pdf-${pages.length}`, safeName: 'sample.pdf', validateWritePath: async path => path,
        imageProcessor: { getMetadata: async () => { throw new Error('No image processor'); }, process: async () => { throw new Error('No thumbnail'); } },
        logger: { info() {}, warn() {}, error() {}, debug() {} },
      });
      expect(readFileSync(result.attachment.storedPath!)).toEqual(bytes);
      expect(result.attachment.representations?.find(r => r.kind === 'original')?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      const markdown = readFileSync(result.attachment.markdownPath!, 'utf8');
      for (const text of pages) expect(markdown).toContain(text);
      if (pages.length > 1) expect(markdown.indexOf(pages[0]!)).toBeLessThan(markdown.indexOf(pages[1]!));
    }
    const bytes = Buffer.from('%PDF-1.4\ncorrupt');
    const broken = await store({
      attachment: { type: 'pdf', path: 'broken.pdf', name: 'broken.pdf', mimeType: 'application/pdf', size: bytes.length, base64: bytes.toString('base64') },
      attachmentsDir: dir, id: 'broken', safeName: 'broken.pdf', validateWritePath: async path => path,
      imageProcessor: { getMetadata: async () => { throw new Error('No image processor'); }, process: async () => { throw new Error('No thumbnail'); } },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    expect(readFileSync(broken.attachment.storedPath!)).toEqual(bytes);
    expect(broken.attachment.markdownPath).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
