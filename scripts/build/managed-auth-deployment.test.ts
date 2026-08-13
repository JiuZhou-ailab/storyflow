// input: Managed-auth and marketing deployment workflows, release workflow, and Worker route configuration
// output: Regression coverage for optional deployment, secret scope, and mandatory live verification
// pos: Contract keeping production deployment authority out of dependency installation and desktop publication

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

const ROOT = join(import.meta.dir, '..', '..')

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

type WorkflowStep = {
  env?: Record<string, unknown>
  name?: string
  run?: string
}

type WorkflowJob = {
  env?: Record<string, unknown>
  steps?: WorkflowStep[]
}

function readDeployJob(path: string): WorkflowJob {
  const workflow = yaml.load(readRepoFile(path)) as {
    jobs?: Record<string, WorkflowJob>
  }

  const deploy = workflow.jobs?.deploy
  expect(deploy).toBeDefined()
  return deploy ?? {}
}

function findStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps?.find((candidate) => candidate.name === name)
  expect(step).toBeDefined()
  return step ?? {}
}

function readWorkflowJobs(path: string): Record<string, WorkflowJob> {
  const workflow = yaml.load(readRepoFile(path)) as {
    jobs?: Record<string, WorkflowJob>
  }

  return workflow.jobs ?? {}
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
    expect(workflow).toContain('payload.exp - now <= 12 * 60 * 60 + 5 * 60')
    expect(workflow).not.toContain('gemini-3.5-flash')
    expect(gatewayDeploy).toBeGreaterThan(0)
    expect(brokerDeploy).toBeGreaterThan(gatewayDeploy)
    expect(workflow).not.toContain('wangsu')
  })

  it('scopes managed-auth production authority to the steps that consume it', () => {
    const deploy = readDeployJob('.github/workflows/deploy-managed-auth.yml')
    const productionEnv = [
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET',
      'STORYFLOW_GATEWAY_JWT_CURRENT_SECRET',
      'STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET',
    ]

    for (const name of productionEnv) {
      expect(deploy.env).not.toHaveProperty(name)
      expect(findStep(deploy, 'Install dependencies').env).not.toHaveProperty(name)
      expect(findStep(deploy, 'Test managed auth contract').env).not.toHaveProperty(name)
    }

    expect(findStep(deploy, 'Verify deployment inputs').env).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
      CLOUDFLARE_ACCOUNT_ID: '${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
      STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET }}',
      STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_GATEWAY_JWT_CURRENT_SECRET }}',
      STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET }}',
    })
    expect(findStep(deploy, 'Deploy model gateway').env).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
      CLOUDFLARE_ACCOUNT_ID: '${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
      STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_GATEWAY_JWT_CURRENT_SECRET }}',
    })
    expect(findStep(deploy, 'Migrate and deploy Skills Market').env).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
      CLOUDFLARE_ACCOUNT_ID: '${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
      STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET }}',
    })
    expect(findStep(deploy, 'Deploy auth broker').env).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
      CLOUDFLARE_ACCOUNT_ID: '${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
      STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET }}',
      STORYFLOW_GATEWAY_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_GATEWAY_JWT_CURRENT_SECRET }}',
      STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET }}',
    })
    expect(findStep(deploy, 'Verify managed auth integration').env).toEqual({
      STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_CLIENT_SESSION_JWT_CURRENT_SECRET }}',
      STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET: '${{ secrets.STORYFLOW_SKILLS_MARKET_JWT_CURRENT_SECRET }}',
    })
  })

  it('scopes marketing production authority to verification and deployment', () => {
    const deploy = readDeployJob('.github/workflows/deploy-marketing.yml')
    const productionEnv = [
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'STORYFLOW_PAGES_PROJECT_NAME',
    ]

    for (const name of productionEnv) {
      expect(deploy.env).not.toHaveProperty(name)
      expect(findStep(deploy, 'Install dependencies').env).not.toHaveProperty(name)
      expect(findStep(deploy, 'Build marketing site').env).not.toHaveProperty(name)
    }

    expect(findStep(deploy, 'Verify deployment configuration').env).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_PAGES_API_TOKEN }}',
      CLOUDFLARE_ACCOUNT_ID: '${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
    })
    expect(findStep(deploy, 'Deploy marketing site to Cloudflare Pages').env).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_PAGES_API_TOKEN }}',
      CLOUDFLARE_ACCOUNT_ID: '${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
      STORYFLOW_PAGES_PROJECT_NAME: "${{ vars.STORYFLOW_PAGES_PROJECT_NAME || 'storyflow' }}",
    })
  })

  it('keeps authenticated dependency installs from running lifecycle code', () => {
    const workflowPaths = [
      '.github/workflows/deploy-marketing.yml',
      '.github/workflows/release.yml',
      '.github/workflows/validate-server.yml',
      '.github/workflows/validate.yml',
    ]

    for (const path of workflowPaths) {
      const installSteps = Object.values(readWorkflowJobs(path))
        .flatMap((job) => job.steps ?? [])
        .filter((step) => step.name === 'Install dependencies')

      expect(installSteps.length, `${path} should define an install step`).toBeGreaterThan(0)

      for (const step of installSteps) {
        expect(step.run).toContain('bun install')
        // Bun's --ignore-scripts prevents project lifecycle hooks while still resolving packages.
        expect(step.run).toContain('--ignore-scripts')
        // Keep the token scoped to install so private registry/git dependencies remain resolvable.
        expect(step.env).toEqual({ GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' })
      }
    }
  })

  it('verifies live managed auth without redeploying it during desktop release', () => {
    const releaseWorkflow = readRepoFile('.github/workflows/release.yml')
    const deployWorkflow = readRepoFile('.github/workflows/deploy-managed-auth.yml')

    expect(releaseWorkflow).toContain('verify-managed-auth:')
    expect(releaseWorkflow).toContain('deploy: false')
    expect(releaseWorkflow).toMatch(/create-release:\n\s+needs: preflight-release-secrets/)
    expect(releaseWorkflow).toMatch(/verify-release:\n\s+needs:\n\s+- validate\n\s+- verify-managed-auth/)
    expect(deployWorkflow).toContain('DEPLOY_MANAGED_AUTH: ${{ inputs.deploy }}')
    expect(deployWorkflow).toContain('if: ${{ inputs.deploy }}')
    expect(deployWorkflow).not.toContain('github.event_name != \'workflow_call\' || inputs.deploy')
    expect(readRepoFile('apps/auth-broker-worker/wrangler.toml')).toContain('workers_dev = false')
    expect(readRepoFile('apps/model-gateway-worker/wrangler.toml')).toContain('workers_dev = false')
  })
})
