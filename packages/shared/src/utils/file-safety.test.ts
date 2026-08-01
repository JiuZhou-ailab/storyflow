// input: User-selected file and directory-relative paths
// output: Regression coverage for shared sensitive-file classification
// pos: Guards the attachment trust boundary used by renderer and server paths

import { describe, expect, it } from 'bun:test'
import { isSensitiveFilePath } from './file-safety'

describe('isSensitiveFilePath', () => {
  it('blocks credential-bearing paths across Unix and Windows separators', () => {
    expect(isSensitiveFilePath('project/.env')).toBe(true)
    expect(isSensitiveFilePath('project/.ssh/id_ed25519')).toBe(true)
    expect(isSensitiveFilePath('project\\.aws\\credentials')).toBe(true)
    expect(isSensitiveFilePath('project/server.pem')).toBe(true)
    expect(isSensitiveFilePath('project/credentials.json')).toBe(true)
  })

  it('allows ordinary source and configuration files', () => {
    expect(isSensitiveFilePath('project/src/index.ts')).toBe(false)
    expect(isSensitiveFilePath('project/config.json')).toBe(false)
  })
})
