// input: Live Skills Market catalog, detail, and bundle endpoints
// output: End-to-end SHA, ResourceBundle import, and Pi discovery verification
// pos: Release gate proving every advertised Skill installs into the runtime

import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  importResources,
  validateResourceBundle,
  type ResourceBundle,
} from '@craft-agent/shared/resources'
import { createSkillCatalogResourceLoader } from '../packages/pi-agent-server/src/project-resource-loader.ts'

interface CatalogSkill {
  slug: string
  version: string
  sha256: string
}

interface SkillDetail extends CatalogSkill {
  downloadPath: string
}

const origin = (process.env.STORYFLOW_SKILLS_MARKET_ORIGIN ?? 'https://storyflow-skills.zjding.com').replace(/\/$/, '')
const scratchRoot = mkdtempSync(join(tmpdir(), 'storyflow-skills-market-'))
const workspaceRoot = join(scratchRoot, 'workspace')
const globalRoot = join(scratchRoot, 'global')
const agentDir = join(scratchRoot, 'agent')
const skillsRoot = join(workspaceRoot, '.pi', 'skills')

function isCatalogSkill(value: unknown): value is CatalogSkill {
  if (!value || typeof value !== 'object') return false
  const skill = value as Record<string, unknown>
  return typeof skill.slug === 'string'
    && typeof skill.version === 'string'
    && typeof skill.sha256 === 'string'
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}`)
  return response.json()
}

try {
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(globalRoot, { recursive: true })
  mkdirSync(agentDir, { recursive: true })

  const catalog = await fetchJson(`${origin}/api/skills?distribution=installable`)
  assert.ok(catalog && typeof catalog === 'object' && Array.isArray((catalog as { skills?: unknown }).skills))
  const skills = (catalog as { skills: unknown[] }).skills
  assert.ok(skills.length > 0, 'Skills Market catalog is empty')
  assert.ok(skills.every(isCatalogSkill), 'Skills Market catalog contains an invalid entry')

  for (const advertised of skills) {
    const detailValue = await fetchJson(`${origin}/api/skills/${encodeURIComponent(advertised.slug)}`)
    assert.ok(detailValue && typeof detailValue === 'object')
    const detail = detailValue as SkillDetail
    assert.equal(detail.slug, advertised.slug)
    assert.equal(detail.version, advertised.version)
    assert.equal(detail.sha256, advertised.sha256)
    assert.equal(typeof detail.downloadPath, 'string')

    const bundleResponse = await fetch(`${origin}${detail.downloadPath}`)
    if (!bundleResponse.ok) throw new Error(`${detail.downloadPath} returned ${bundleResponse.status}: ${await bundleResponse.text()}`)
    const bytes = new Uint8Array(await bundleResponse.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    assert.equal(sha256, advertised.sha256, `${advertised.slug} bundle checksum differs from catalog`)
    assert.equal(bundleResponse.headers.get('x-content-sha256'), advertised.sha256)

    const bundle = JSON.parse(new TextDecoder().decode(bytes)) as ResourceBundle
    const validation = validateResourceBundle(bundle)
    assert.equal(validation.valid, true, `${advertised.slug}: ${validation.errors.join('; ')}`)
    assert.deepEqual(bundle.resources.skills?.map(skill => skill.slug), [advertised.slug])

    const imported = await importResources(
      workspaceRoot,
      bundle,
      'skip',
      { clearSourceCredentials: async () => {} },
      skillsRoot,
    )
    assert.deepEqual(imported.skills.imported, [advertised.slug])
    assert.deepEqual(imported.skills.failed, [])
  }

  const resourceLoader = await createSkillCatalogResourceLoader({ cwd: workspaceRoot, globalRoot, agentDir })
  const discovered = new Set(resourceLoader.getSkills().skills.map(skill => skill.name))
  for (const skill of skills) assert.ok(discovered.has(skill.slug), `Pi did not discover ${skill.slug}`)

  console.log(JSON.stringify({ catalog: skills.length, details: skills.length, bundles: skills.length, imports: skills.length, piDiscovered: skills.length }))
} finally {
  rmSync(scratchRoot, { recursive: true, force: true })
}
