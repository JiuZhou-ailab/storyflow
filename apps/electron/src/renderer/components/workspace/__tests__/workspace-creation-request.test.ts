// input: Renderer workspace creation API, local or remote request data, and completion callback
// output: Behavioral checks for the Electron workspace creation request boundary
// pos: Ensures blank local projects carry no hidden project profile options

import { beforeAll, describe, expect, it, mock } from 'bun:test'
import type { RemoteServerConnectionInput, Workspace } from '../../../../shared/types'

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
      undefined,
      async (result) => {
        created.push(result)
      },
    )

    expect(calls).toEqual([['/projects/new-story', '新项目']])
    expect(created).toEqual([workspace])
  })

  it('sends only remote server configuration for a remote workspace', async () => {
    const calls: unknown[][] = []
    const remoteServer: RemoteServerConnectionInput = {
      url: 'https://storyflow.example.test',
      token: 'test-token',
      remoteWorkspaceId: 'remote-1',
    }

    await createWorkspaceAndNotify(
      {
        createWorkspace: async (...args) => {
          calls.push(args)
          return workspace
        },
      },
      '/projects/remote-story',
      '远端项目',
      remoteServer,
      () => {},
    )

    expect(calls).toEqual([[
      '/projects/remote-story',
      '远端项目',
      { remoteServer },
    ]])
  })
})
