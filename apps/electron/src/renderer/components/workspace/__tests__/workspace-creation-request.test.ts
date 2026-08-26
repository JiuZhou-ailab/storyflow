// input: Renderer local workspace creation API, completion callback, and App creation navigation
// output: Checks for option-free creation and zero-session project opening
// pos: Guards folder-first creation from hidden profiles and implicit conversations

import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Workspace } from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let createWorkspaceAndNotify: typeof import('../WorkspaceCreationScreen').createWorkspaceAndNotify

beforeAll(async () => {
  const module = await import('../WorkspaceCreationScreen')
  createWorkspaceAndNotify = module.createWorkspaceAndNotify
})

const workspace = { id: 'workspace-1', name: '新项目' } as Workspace
const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')

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

  it('opens a new project without creating a starting session', () => {
    const start = appSource.indexOf('const handleProjectHubWorkspaceCreated')
    const end = appSource.indexOf('const handleClientSignedIn', start)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const creationHandler = appSource.slice(start, end)
    expect(creationHandler).toContain('await handleSelectWorkspace(workspace.id)')
    expect(creationHandler).not.toContain('handleCreateSession')
    expect(creationHandler).not.toContain('handleSelectProjectSession')
  })
})
