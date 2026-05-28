import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readClientAuthOverrides } from '../client-auth-overrides'

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'client-auth-overrides-'))
}

describe('readClientAuthOverrides', () => {
  it('returns empty overrides when the file is missing', () => {
    const dir = makeTempDir()
    const result = readClientAuthOverrides(dir)

    expect(result.filePath).toBe(path.join(dir, 'client-auth.json'))
    expect(result.values).toEqual({})
  })

  it('returns empty overrides when the file is not valid JSON', () => {
    const dir = makeTempDir()
    writeFileSync(path.join(dir, 'client-auth.json'), '{ broken')

    expect(readClientAuthOverrides(dir).values).toEqual({})
  })

  it('returns empty overrides when the JSON root is not an object', () => {
    const dir = makeTempDir()
    writeFileSync(path.join(dir, 'client-auth.json'), '["not", "an", "object"]')

    expect(readClientAuthOverrides(dir).values).toEqual({})
  })

  it('maps authBrokerUrl to CRAFT_CLIENT_AUTH_BROKER_URL', () => {
    const dir = makeTempDir()
    writeFileSync(
      path.join(dir, 'client-auth.json'),
      JSON.stringify({ authBrokerUrl: 'https://broker.example.com/' }),
    )

    expect(readClientAuthOverrides(dir).values).toEqual({
      CRAFT_CLIENT_AUTH_BROKER_URL: 'https://broker.example.com/',
    })
  })

  it('trims whitespace and ignores non-string values', () => {
    const dir = makeTempDir()
    writeFileSync(
      path.join(dir, 'client-auth.json'),
      JSON.stringify({ authBrokerUrl: '  https://broker.example.com  ', extra: 42 }),
    )

    expect(readClientAuthOverrides(dir).values).toEqual({
      CRAFT_CLIENT_AUTH_BROKER_URL: 'https://broker.example.com',
    })
  })

  it('ignores empty strings', () => {
    const dir = makeTempDir()
    writeFileSync(path.join(dir, 'client-auth.json'), JSON.stringify({ authBrokerUrl: '   ' }))

    expect(readClientAuthOverrides(dir).values).toEqual({})
  })
})
