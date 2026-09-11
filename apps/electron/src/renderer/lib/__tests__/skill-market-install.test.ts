import { describe, expect, it } from 'bun:test'
import { installMarketSkill } from '../skill-market-install'

describe('Market installation transaction', () => {
  const identity = { slug: 'writing', version: '1.0.0', sha256: 'a'.repeat(64) }
  const download = { bundle: { version: 1, exportedAt: 1, resources: {} }, raw: 'verified bytes', sha256: identity.sha256 } as const

  it('uses authenticated download and preserves exact verified bytes in a project-only receipt', async () => {
    const calls: unknown[] = []
    const api = {
      downloadSkillFromMarket: async (input: unknown) => { calls.push(input); return download },
      importResources: async (...args: unknown[]) => {
        calls.push(args)
        return { skills: { imported: ['writing'], skipped: [], failed: [], warnings: [] } }
      },
    }
    expect(await installMarketSkill(api as never, identity, 'project-a', () => true)).toBe('installed')
    expect(calls).toEqual([identity, ['project-a', download.bundle, 'skip', {
      skillScope: 'project', installArtifact: { ...identity, raw: download.raw },
    }]])
  })

  it('does not write after a download failure or a project switch', async () => {
    let writes = 0
    const api = {
      downloadSkillFromMarket: async () => download,
      importResources: async () => { writes++; throw new Error('must not import') },
    }
    await expect(installMarketSkill(api as never, identity, 'project-a', () => false)).rejects.toThrow('project changed')
    api.downloadSkillFromMarket = async () => { throw new Error('checksum mismatch') }
    await expect(installMarketSkill(api as never, identity, 'project-a', () => true)).rejects.toThrow('checksum mismatch')
    expect(writes).toBe(0)
  })

  it('reports skipped installs and propagates import errors without pretending success', async () => {
    const bucket = { imported: [] as string[], skipped: ['writing'], failed: [] as { id: string; error: string }[] }
    const api = { downloadSkillFromMarket: async () => download, importResources: async () => ({ skills: bucket }) }
    expect(await installMarketSkill(api as never, identity, 'a', () => true)).toBe('exists')
    bucket.skipped = []
    bucket.failed = [{ id: 'writing', error: 'invalid skill content' }]
    await expect(installMarketSkill(api as never, identity, 'a', () => true)).rejects.toThrow('invalid skill content')
  })
})
