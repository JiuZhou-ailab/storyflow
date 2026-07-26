// input: Managed-auth deployment workflow, release workflow, and Worker route configuration
// output: Regression coverage for ordered infrastructure deployment and release gating
// pos: Release contract preventing desktop publication before the managed gateway is live

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('managed auth deployment', () => {
  it('deploys and canaries the gateway before the broker', () => {
    const workflowPath = join(ROOT, '.github/workflows/deploy-managed-auth.yml')
    expect(existsSync(workflowPath)).toBe(true)

    const workflow = readFileSync(workflowPath, 'utf8')
    const gatewayDeploy = workflow.indexOf('Deploy and canary model gateway')
    const brokerDeploy = workflow.indexOf('Deploy and verify auth broker')

    expect(workflow).toContain('workflow_call:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET')
    expect(workflow).toContain('STORYFLOW_GATEWAY_JWT_CURRENT_SECRET')
    expect(workflow).toContain('model_access_token_invalid')
    expect(workflow).toContain('client_session_token_invalid')
    expect(gatewayDeploy).toBeGreaterThan(0)
    expect(brokerDeploy).toBeGreaterThan(gatewayDeploy)
    expect(workflow).not.toContain('wangsu')
  })

  it('blocks the desktop release on managed auth deployment', () => {
    const releaseWorkflow = readRepoFile('.github/workflows/release.yml')

    expect(releaseWorkflow).toContain('deploy-managed-auth:')
    expect(releaseWorkflow).toMatch(
      /create-release:\n\s+needs:\n\s+- validate\n\s+- preflight-release-secrets\n\s+- deploy-managed-auth/,
    )
    expect(readRepoFile('apps/auth-broker-worker/wrangler.toml')).toContain('workers_dev = false')
    expect(readRepoFile('apps/model-gateway-worker/wrangler.toml')).toContain('workers_dev = false')
  })
})
