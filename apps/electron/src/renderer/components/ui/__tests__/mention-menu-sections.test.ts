import { beforeAll, describe, expect, it, mock } from 'bun:test'
import type { LoadedSkill, LoadedSource } from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let createMentionSections: typeof import('../mention-menu').createMentionSections

beforeAll(async () => {
  const mod = await import('../mention-menu')
  createMentionSections = mod.createMentionSections
})

function skill(slug: string): LoadedSkill {
  return {
    slug,
    metadata: { name: slug, description: '' },
    content: '',
    path: `/skills/${slug}`,
    source: 'workspace',
  }
}

function source(slug: string): LoadedSource {
  return {
    config: {
      slug,
      name: slug,
      tagline: '',
      type: 'local',
    },
    guide: null,
    folderPath: `/sources/${slug}`,
    workspaceRootPath: '/workspace',
    workspaceId: 'workspace',
  } as LoadedSource
}

describe('mention menu sections', () => {
  it('keeps @ mentions scoped to context objects instead of skills', () => {
    const sections = createMentionSections({
      skills: [skill('review-pr')],
      sources: [source('github')],
      files: [],
      filter: '',
      fileResults: [],
    })

    expect(sections.map(section => section.id)).toEqual(['sources'])
  })
})
