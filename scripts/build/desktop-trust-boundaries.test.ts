// input: Desktop build, package, transport, and telemetry configuration
// output: Release guards for local-first auth, verified TLS, zero-content telemetry, and production-only assets
// pos: Public build/config seam for the Electron trust boundary

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

const rootDir = join(import.meta.dir, '..', '..')

function readRepoFile(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8')
}

describe('desktop trust boundaries', () => {
  test('official releases keep the local desktop shell available before login', () => {
    const workflow = readRepoFile('.github/workflows/release.yml')
    expect(workflow).not.toContain('CRAFT_CLIENT_AUTH_REQUIRED: "true"')
    expect(workflow.match(/CRAFT_CLIENT_AUTH_REQUIRED: "false"/g)).toHaveLength(2)
  })

  test('ships no automatic desktop monitoring client or ingest configuration', () => {
    const rootPackage = readRepoFile('package.json')
    const electronPackage = readRepoFile('apps/electron/package.json')
    const desktopSources = [
      readRepoFile('apps/electron/src/main/index.ts'),
      readRepoFile('apps/electron/src/preload/bootstrap.ts'),
      readRepoFile('apps/electron/src/renderer/main.tsx'),
      readRepoFile('apps/electron/src/renderer/event-processor/useEventProcessor.ts'),
      readRepoFile('apps/electron/src/renderer/components/app-shell/input/InputErrorBoundary.tsx'),
      readRepoFile('scripts/electron-build-main.ts'),
      readRepoFile('.env.example'),
    ].join('\n')

    expect(rootPackage).not.toContain('@sentry/')
    expect(rootPackage).not.toContain('@github/copilot-sdk')
    expect(electronPackage).not.toContain('posthog-node')
    expect(desktopSources).not.toMatch(/@sentry\/|SENTRY_|POSTHOG_/)
  })

  test('keeps Playground in dev without making it a production renderer entry', () => {
    const rootPackage = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>
    }
    const viteConfig = readRepoFile('apps/electron/vite.config.ts')

    expect(rootPackage.scripts['playground:dev']).toContain('/playground.html')
    expect(viteConfig).not.toMatch(/playground:\s*resolve\([^)]*playground\.html/)
  })

  test('verifies remote TLS certificates and keeps stale runtimes out of packages', () => {
    const mainSource = readRepoFile('apps/electron/src/main/index.ts')
    const preloadSource = readRepoFile('apps/electron/src/preload/bootstrap.ts')
    const workspaceSource = readRepoFile('apps/electron/src/main/handlers/workspace.ts')
    const builder = yaml.load(readRepoFile('apps/electron/electron-builder.yml')) as Record<string, unknown>
    const builderText = JSON.stringify(builder)

    expect(mainSource).not.toContain("app.on('certificate-error'")
    expect(preloadSource).not.toContain('tlsRejectUnauthorized: false')
    expect(workspaceSource).not.toContain('tlsRejectUnauthorized: false')
    expect(builderText).not.toMatch(/vendor\/(?:codex|copilot)/)
  })
})
