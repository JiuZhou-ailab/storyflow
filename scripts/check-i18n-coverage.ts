/**
 * check-i18n-coverage.ts — Verify literal i18n callsites exist in en.json.
 *
 * Scans production TypeScript/React sources for literal `t('key')`,
 * `i18n.t('key')`, and `<Trans i18nKey="key">` references. Dynamic keys are
 * intentionally skipped; they are covered by runtime missing-key diagnostics.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const EN_LOCALE_PATH = join(ROOT, 'packages', 'shared', 'src', 'i18n', 'locales', 'en.json')
const SOURCE_ROOTS = [
  join(ROOT, 'apps', 'electron', 'src'),
  join(ROOT, 'packages', 'shared', 'src'),
  join(ROOT, 'packages', 'ui', 'src'),
]

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SKIPPED_DIRS = new Set([
  '__tests__',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
])

interface MissingReference {
  file: string
  line: number
  key: string
}

function loadEnglishKeys(): Set<string> {
  const raw = readFileSync(EN_LOCALE_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  return new Set(Object.keys(parsed))
}

function fileExtension(path: string): string {
  const index = path.lastIndexOf('.')
  return index === -1 ? '' : path.slice(index)
}

function listSourceFiles(root: string): string[] {
  if (!existsSync(root)) return []

  const files: string[] = []
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIPPED_DIRS.has(name)) continue
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        visit(path)
        continue
      }
      if (stat.isFile() && SOURCE_EXTENSIONS.has(fileExtension(path))) {
        files.push(path)
      }
    }
  }

  visit(root)
  return files
}

function lineNumberAt(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

function collectLiteralKeys(content: string): Array<{ key: string; index: number }> {
  const references: Array<{ key: string; index: number }> = []
  const callPatterns = [
    /\bt\s*\(\s*(['"])([A-Za-z0-9_.:-]+)\1/g,
    /\bi18n\.t\s*\(\s*(['"])([A-Za-z0-9_.:-]+)\1/g,
    /\bi18next\.t\s*\(\s*(['"])([A-Za-z0-9_.:-]+)\1/g,
  ]
  const transPattern = /<Trans\b[^>]*\bi18nKey\s*=\s*(['"])([A-Za-z0-9_.:-]+)\1/g

  for (const pattern of callPatterns) {
    for (const match of content.matchAll(pattern)) {
      const key = match[2]
      if (key) references.push({ key, index: match.index ?? 0 })
    }
  }

  for (const match of content.matchAll(transPattern)) {
    const key = match[2]
    if (key) references.push({ key, index: match.index ?? 0 })
  }

  return references
}

function hasCoveredKey(keys: Set<string>, key: string): boolean {
  return keys.has(key) || keys.has(`${key}_one`) || keys.has(`${key}_other`)
}

function main(): void {
  const englishKeys = loadEnglishKeys()
  const missing: MissingReference[] = []

  for (const root of SOURCE_ROOTS) {
    for (const file of listSourceFiles(root)) {
      if (file.includes(`${join('src', 'i18n', 'locales')}${resolve('/').slice(0, 0)}`)) continue
      const content = readFileSync(file, 'utf-8')
      if (!content.includes('t(') && !content.includes('i18nKey')) continue

      for (const reference of collectLiteralKeys(content)) {
        if (!hasCoveredKey(englishKeys, reference.key)) {
          missing.push({
            file: relative(ROOT, file),
            line: lineNumberAt(content, reference.index),
            key: reference.key,
          })
        }
      }
    }
  }

  if (missing.length > 0) {
    console.error(`i18n coverage failed: ${missing.length} literal key reference(s) missing from en.json`)
    for (const item of missing) {
      console.error(`  ${item.file}:${item.line} ${item.key}`)
    }
    process.exit(1)
  }

  console.log(`i18n coverage OK (${englishKeys.size} en keys)`)
}

main()
