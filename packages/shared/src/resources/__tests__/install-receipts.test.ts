// input: Verified old/new Skill bundle bytes and temporary project Skill roots
// output: Regression proof for durable install receipts and modification-preserving upgrades
// pos: Executable contract preventing generic overwrite from masquerading as a Market upgrade

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MAX_SKILL_INSTALL_ARTIFACT_BYTES,
  importResources,
  listSkillInstallReceipts,
  readSkillInstallReceipt,
  upgradeInstalledSkill,
} from '../index.ts'
import type {
  ResourceBundle,
  SkillInstallArtifact,
  SkillInstallReceipt,
} from '../types.ts'

const noopDeps = { clearSourceCredentials: async () => {} }

function bundleFile(relativePath: string, content: string) {
  const bytes = Buffer.from(content)
  return { relativePath, contentBase64: bytes.toString('base64'), size: bytes.byteLength }
}

function skillArtifact(
  slug: string,
  version: string,
  files: Record<string, string>,
): { bundle: ResourceBundle; artifact: SkillInstallArtifact } {
  const bundle: ResourceBundle = {
    version: 1,
    exportedAt: 1,
    resources: {
      skills: [{
        slug,
        files: Object.entries(files).map(([path, content]) => bundleFile(path, content)),
      }],
    },
  }
  const raw = JSON.stringify(bundle)
  return {
    bundle,
    artifact: {
      slug,
      version,
      sha256: createHash('sha256').update(raw).digest('hex'),
      raw,
    },
  }
}

describe('Skill install receipts', () => {
  let root: string
  let workspaceRoot: string
  let skillsRoot: string

  beforeEach(() => {
    root = join(tmpdir(), `storyflow-install-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    workspaceRoot = join(root, 'workspace')
    skillsRoot = join(workspaceRoot, '.pi', 'skills')
    mkdirSync(join(workspaceRoot, '.craft-agent'), { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('commits a minimal receipt with a new Skill and exposes it through query APIs', async () => {
    const { bundle, artifact } = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nReview.',
    })
    const receipt: SkillInstallReceipt = {
      kind: 'skill',
      slug: artifact.slug,
      version: artifact.version,
      sha256: artifact.sha256,
      scope: 'project',
    }

    const result = await importResources(
      workspaceRoot,
      bundle,
      'skip',
      noopDeps,
      skillsRoot,
      { skillScope: 'project', installArtifact: artifact },
    )

    expect(result.skills.imported).toEqual(['story-review'])
    expect(readSkillInstallReceipt(skillsRoot, 'story-review')).toEqual(receipt)
    expect(listSkillInstallReceipts(skillsRoot)).toEqual([receipt])
    expect(JSON.parse(readFileSync(join(skillsRoot, 'story-review', '.storyflow-install.json'), 'utf8')))
      .toEqual(receipt)
  })

  it('does not attribute a receipt to a different local Skill directory', async () => {
    const requested = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nRequested.',
    })
    await importResources(
      workspaceRoot,
      requested.bundle,
      'skip',
      noopDeps,
      skillsRoot,
      { skillScope: 'project', installArtifact: requested.artifact },
    )
    const receiptPath = join(skillsRoot, 'story-review', '.storyflow-install.json')
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as SkillInstallReceipt
    writeFileSync(receiptPath, JSON.stringify({ ...receipt, slug: 'different-skill' }))

    expect(readSkillInstallReceipt(skillsRoot, 'story-review')).toBeNull()
    expect(listSkillInstallReceipts(skillsRoot)).toEqual([])
  })

  it('rejects package-supplied install metadata across portable casing', async () => {
    const injected = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nRequested.',
      '.STORYFLOW-INSTALL.JSON': JSON.stringify({
        kind: 'skill',
        slug: 'story-review',
        version: '9.9.9',
        sha256: 'a'.repeat(64),
        scope: 'user',
      }),
    })

    const result = await importResources(
      workspaceRoot,
      injected.bundle,
      'skip',
      noopDeps,
      skillsRoot,
      { skillScope: 'project', installArtifact: injected.artifact },
    )

    expect(result.skills.failed[0]?.error).toContain('reserved for local install metadata')
    expect(existsSync(join(skillsRoot, 'story-review'))).toBe(false)
  })

  it('rejects a receipt on generic overwrite without touching the installed Skill', async () => {
    const current = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nOriginal.',
    })
    const next = skillArtifact('story-review', '2.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nReplacement.',
    })
    const receipt: SkillInstallReceipt = {
      kind: 'skill',
      slug: current.artifact.slug,
      version: current.artifact.version,
      sha256: current.artifact.sha256,
      scope: 'project',
    }
    await importResources(
      workspaceRoot,
      current.bundle,
      'skip',
      noopDeps,
      skillsRoot,
      { skillScope: 'project', installArtifact: current.artifact },
    )

    const result = await importResources(
      workspaceRoot,
      next.bundle,
      'overwrite',
      noopDeps,
      skillsRoot,
      {
        skillScope: 'project',
        installArtifact: next.artifact,
      },
    )

    expect(result.skills.failed[0]?.error).toContain('explicit upgrade')
    expect(readFileSync(join(skillsRoot, 'story-review', 'SKILL.md'), 'utf8')).toContain('Original.')
    expect(readSkillInstallReceipt(skillsRoot, 'story-review')).toEqual(receipt)
  })

  it('does not record provenance when the verified artifact differs from the imported bundle', async () => {
    const requested = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nRequested.',
    })
    const tampered = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nTampered.',
    })

    const result = await importResources(
      workspaceRoot,
      tampered.bundle,
      'skip',
      noopDeps,
      skillsRoot,
      { skillScope: 'project', installArtifact: requested.artifact },
    )

    expect(result.skills.failed[0]?.error).toContain('does not match')
    expect(existsSync(join(skillsRoot, 'story-review'))).toBe(false)
  })

  it('rejects oversized artifact bytes before parsing or writing them', async () => {
    const requested = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nRequested.',
    })
    const raw = 'x'.repeat(MAX_SKILL_INSTALL_ARTIFACT_BYTES + 1)
    const oversized: SkillInstallArtifact = {
      ...requested.artifact,
      raw,
      sha256: createHash('sha256').update(raw).digest('hex'),
    }

    const result = await importResources(
      workspaceRoot,
      requested.bundle,
      'skip',
      noopDeps,
      skillsRoot,
      { skillScope: 'project', installArtifact: oversized },
    )

    expect(result.skills.failed[0]?.error).toContain('exceeds 5 MB')
    expect(existsSync(join(skillsRoot, 'story-review'))).toBe(false)
  })

  it('upgrades unmodified package files while preserving local edits, additions, and deletions', async () => {
    const current = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nOriginal instructions.',
      'guide.md': 'old guide',
      'removed.md': 'remove me',
      'locally-deleted.md': 'delete locally',
    })
    const next = skillArtifact('story-review', '2.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nNew instructions.',
      'guide.md': 'new guide',
      'added.md': 'new file',
      'locally-deleted.md': 'new upstream copy',
    })
    const receipt: SkillInstallReceipt = {
      kind: 'skill',
      slug: current.artifact.slug,
      version: current.artifact.version,
      sha256: current.artifact.sha256,
      scope: 'project',
    }
    await importResources(
      workspaceRoot,
      current.bundle,
      'skip',
      noopDeps,
      skillsRoot,
      { skillScope: 'project', installArtifact: current.artifact },
    )
    const skillRoot = join(skillsRoot, 'story-review')
    writeFileSync(
      join(skillRoot, 'SKILL.md'),
      '---\nname: story-review\ndescription: Review stories\n---\n\nMy local instructions.',
    )
    writeFileSync(join(skillRoot, 'custom.md'), 'local file')
    rmSync(join(skillRoot, 'locally-deleted.md'))

    const result = upgradeInstalledSkill(
      skillsRoot,
      current.artifact,
      next.artifact,
      { scope: 'project', projectRootPath: workspaceRoot },
    )

    expect(result.receipt).toEqual({
      ...receipt,
      version: next.artifact.version,
      sha256: next.artifact.sha256,
    })
    expect(result.preservedPaths).toEqual(['SKILL.md', 'custom.md', 'locally-deleted.md'])
    expect(readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')).toContain('My local instructions.')
    expect(readFileSync(join(skillRoot, 'guide.md'), 'utf8')).toBe('new guide')
    expect(readFileSync(join(skillRoot, 'added.md'), 'utf8')).toBe('new file')
    expect(readFileSync(join(skillRoot, 'custom.md'), 'utf8')).toBe('local file')
    expect(existsSync(join(skillRoot, 'removed.md'))).toBe(false)
    expect(existsSync(join(skillRoot, 'locally-deleted.md'))).toBe(false)
    expect(readSkillInstallReceipt(skillsRoot, 'story-review')).toEqual(result.receipt)
  })

  it('fails closed when the supplied current artifact does not match the durable receipt', async () => {
    const current = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nOriginal.',
    })
    const next = skillArtifact('story-review', '2.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nNext.',
    })
    const receipt: SkillInstallReceipt = {
      kind: 'skill',
      slug: current.artifact.slug,
      version: current.artifact.version,
      sha256: current.artifact.sha256,
      scope: 'project',
    }
    await importResources(
      workspaceRoot,
      current.bundle,
      'skip',
      noopDeps,
      skillsRoot,
      { skillScope: 'project', installArtifact: current.artifact },
    )
    const mismatchedCurrent = skillArtifact('story-review', '1.0.0', {
      'SKILL.md': '---\nname: story-review\ndescription: Review stories\n---\n\nDifferent base.',
    })

    expect(() => upgradeInstalledSkill(
      skillsRoot,
      mismatchedCurrent.artifact,
      next.artifact,
      { scope: 'project', projectRootPath: workspaceRoot },
    )).toThrow('current artifact')
    expect(readFileSync(join(skillsRoot, 'story-review', 'SKILL.md'), 'utf8')).toContain('Original.')
    expect(readSkillInstallReceipt(skillsRoot, 'story-review')).toEqual(receipt)
  })
})
