// input: Workspace file path and observable shell boundary doubles
// output: Regression coverage for file-level Finder reveal behavior
// pos: Public application-action seam between the workspace tree and Electron shell

import { describe, expect, it } from 'bun:test'
import { revealWorkspaceFile } from '../workspace-file-actions'

describe('workspace file actions', () => {
  it('reveals the selected native workspace file through the shell boundary', async () => {
    const revealedPaths: string[] = []
    const errors: unknown[] = []

    await revealWorkspaceFile({
      path: '/workspace/正文/第01集.md',
      showInFolder: async path => { revealedPaths.push(path) },
      onError: error => { errors.push(error) },
    })

    expect(revealedPaths).toEqual(['/workspace/正文/第01集.md'])
    expect(errors).toEqual([])
  })

  it('routes a shell reveal failure to the caller without leaking a rejected menu action', async () => {
    const failure = new Error('Finder unavailable')
    const errors: unknown[] = []

    await expect(revealWorkspaceFile({
      path: '/workspace/正文/第01集.md',
      showInFolder: async () => { throw failure },
      onError: error => { errors.push(error) },
    })).resolves.toBeUndefined()

    expect(errors).toEqual([failure])
  })
})
