// input: Live Skills Market catalog, detail, and bundle endpoints
// output: End-to-end SHA, ResourceBundle import, and Pi discovery verification through the desktop parsers
// pos: Release gate proving every advertised Skill parses with the shipped client and installs into the runtime

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
import {
  DEFAULT_SKILLS_MARKET_ORIGIN,
  parseMarketSkillDetail,
  parseMarketSkillListResponse,
} from '@craft-agent/shared/skills/marketplace'
import { createSkillCatalogResourceLoader } from '../packages/pi-agent-server/src/project-resource-loader.ts'

const origin = (process.env.STORYFLOW_SKILLS_MARKET_ORIGIN ?? DEFAULT_SKILLS_MARKET_ORIGIN).replace(/\/$/, '')
const scratchRoot = mkdtempSync(join(tmpdir(), 'storyflow-skills-market-'))
const workspaceRoot = join(scratchRoot, 'workspace')
const globalRoot = join(scratchRoot, 'global')
const agentDir = join(scratchRoot, 'agent')
const skillsRoot = join(workspaceRoot, '.pi', 'skills')

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}`)
  return response.json()
}

try {
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(globalRoot, { recursive: true })
  mkdirSync(agentDir, { recursive: true })

  const catalog = parseMarketSkillListResponse(await fetchJson(`${origin}/api/skills?distribution=installable`))
  const skills = catalog.skills
  assert.ok(skills.length > 0, 'Skills Market catalog is empty')

  for (const advertised of skills) {
    const detail = parseMarketSkillDetail(await fetchJson(`${origin}/api/skills/${encodeURIComponent(advertised.slug)}`))
    assert.equal(detail.slug, advertised.slug)
    assert.equal(detail.version, advertised.version)
    assert.equal(detail.sha256, advertised.sha256)

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
