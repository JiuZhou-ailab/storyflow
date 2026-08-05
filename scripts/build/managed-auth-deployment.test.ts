// input: Managed-auth deployment workflow, release workflow, and Worker route configuration
// output: Regression coverage for optional deployment and mandatory live verification
// pos: Contract keeping managed-service mutation separate from desktop publication

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('managed auth deployment', () => {
  it('deploys in dependency order and supports read-only verification', () => {
    const workflowPath = join(ROOT, '.github/workflows/deploy-managed-auth.yml')
    expect(existsSync(workflowPath)).toBe(true)

    const workflow = readFileSync(workflowPath, 'utf8')
    const gatewayDeploy = workflow.indexOf('Deploy model gateway')
    const brokerDeploy = workflow.indexOf('Deploy auth broker')

    expect(workflow).toContain('workflow_call:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('deploy:')
    expect(workflow).toContain('DEPLOY_MANAGED_AUTH')
    expect(workflow).toContain('Verify managed auth integration')
    expect(workflow).toContain('STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET')
    expect(workflow).toContain('STORYFLOW_GATEWAY_JWT_CURRENT_SECRET')
    expect(workflow).toContain('STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET')
    expect(workflow).toContain('model_access_token_invalid')
    expect(workflow).toContain('client_session_token_invalid')
    expect(workflow).toContain('MODEL_CATALOG_RESPONSE_PATH')
    expect(workflow).toContain('MARKET_TOKEN_RESPONSE_PATH')
    expect(workflow).not.toContain('gemini-3.5-flash')
    expect(gatewayDeploy).toBeGreaterThan(0)
    expect(brokerDeploy).toBeGreaterThan(gatewayDeploy)
    expect(workflow).not.toContain('wangsu')
  })

  it('verifies live managed auth without redeploying it during desktop release', () => {
    const releaseWorkflow = readRepoFile('.github/workflows/release.yml')

    expect(releaseWorkflow).toContain('verify-managed-auth:')
    expect(releaseWorkflow).toContain('deploy: false')
    expect(releaseWorkflow).toMatch(/create-release:\n\s+needs: preflight-release-secrets/)
    expect(releaseWorkflow).toMatch(/verify-release:\n\s+needs:\n\s+- validate\n\s+- verify-managed-auth/)
    expect(readRepoFile('apps/auth-broker-worker/wrangler.toml')).toContain('workers_dev = false')
    expect(readRepoFile('apps/model-gateway-worker/wrangler.toml')).toContain('workers_dev = false')
  })
})
