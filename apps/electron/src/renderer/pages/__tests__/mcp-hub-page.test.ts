// input: MCP Hub page source and the shared endpoint-admission contract
// output: Regression check for explicit confirmation through the existing Source runtime
// pos: Small source-level UI guard isolated from Electron's browser-only dependency graph

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../McpHubPage.tsx', import.meta.url), 'utf8')

test('MCP discovery reviews the endpoint and creates only an existing local Source', () => {
  expect(source).toContain('getMcpRegistryInstallDecision(server)')
  expect(source).toContain("t('mcpHub.confirmDescription'")
  expect(source).toContain('window.electronAPI.createSource(targetWorkspaceId, decision.input)')
  expect(source).toContain('currentWorkspaceId.current !== targetWorkspaceId')
  expect(source).not.toContain('connectMcp')
  expect(source).not.toContain('authorizeTools')
})
