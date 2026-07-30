// input: Renderer local workspace creation API and completion callback
// output: Behavioral checks for the Electron workspace creation request boundary
// pos: Ensures local projects carry no remote or hidden profile options

import { beforeAll, describe, expect, it, mock } from 'bun:test'
import type { Workspace } from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let createWorkspaceAndNotify: typeof import('../WorkspaceCreationScreen').createWorkspaceAndNotify

beforeAll(async () => {
  const module = await import('../WorkspaceCreationScreen')
  createWorkspaceAndNotify = module.createWorkspaceAndNotify
})

const workspace = { id: 'workspace-1', name: '新项目' } as Workspace

describe('workspace creation request', () => {
  it('creates a local workspace without options and notifies the caller', async () => {
    const calls: unknown[][] = []
    const created: Workspace[] = []

    await createWorkspaceAndNotify(
      {
        createWorkspace: async (...args) => {
          calls.push(args)
          return workspace
        },
      },
      '/projects/new-story',
      '新项目',
      async (result) => {
        created.push(result)
      },
    )

    expect(calls).toEqual([['/projects/new-story', '新项目']])
    expect(created).toEqual([workspace])
  })

})
