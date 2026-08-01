// input: Shared RPC transport plus platform and SessionManager dependencies
// output: Core RPC registration split between shell-safe and runtime-gated domains
// pos: Defines the server-core capability boundary exposed by every host

import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

import { registerAuthHandlers } from './auth'
import { registerAutomationsHandlers } from './automations'
import { registerFilesHandlers } from './files'
import { registerWorkspaceFileMutationHandlers } from './workspace-file-mutations'
import { registerLabelsHandlers } from './labels'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerResourcesHandlers } from './resources'
import { registerOnboardingHandlers } from './onboarding'
import { registerSearchHandlers } from './search'
import { registerSessionsHandlers } from './sessions'
export { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { registerServerHandlers } from './server'
import type { ServerHandlerContext } from '../../bootstrap/headless-start'
export type { ServerHandlerContext } from '../../bootstrap/headless-start'
export { getHealthCheck } from './server'
import { registerSettingsHandlers } from './settings'
import { registerSkillsHandlers } from './skills'
import { registerSourcesHandlers } from './sources'
import { registerStatusesHandlers } from './statuses'
import { registerSystemCoreHandlers } from './system'
import { registerTransferHandlers } from './transfer'
import { registerWorkspaceCoreHandlers } from './workspace'
import { registerMessagingHandlers } from './messaging'
import { createInitGatedRpcServer } from './init-gated-server'
import { resolveContextWorkspaceId } from './file-workspace-scope'

export { createInitGatedRpcServer } from './init-gated-server'

export function registerCoreRpcHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
): void {
  const runtimeServer = createInitGatedRpcServer(
    server,
    (scopeId) => deps.sessionManager.waitForInit(scopeId),
    // ADR 0013: same workspace resolution the handlers themselves use, so a request
    // waits for exactly the runtime domain it will read from.
    (ctx) => resolveContextWorkspaceId(ctx, deps),
  )

  registerAuthHandlers(server, deps)
  registerAutomationsHandlers(runtimeServer, deps)
  registerFilesHandlers(server, deps)
  registerWorkspaceFileMutationHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerLlmConnectionsHandlers(runtimeServer, deps)
  registerOAuthHandlers(runtimeServer, deps)
  registerOnboardingHandlers(server, deps)
  registerResourcesHandlers(server, deps)
  registerSearchHandlers(runtimeServer, deps)
  registerSessionsHandlers(runtimeServer, deps)
  if (serverCtx) registerServerHandlers(server, deps, serverCtx)
  registerSettingsHandlers(runtimeServer, deps)
  registerSkillsHandlers(server, deps)
  registerSourcesHandlers(server, deps)
  registerStatusesHandlers(server, deps)
  registerSystemCoreHandlers(server, deps)
  registerTransferHandlers(server)
  registerWorkspaceCoreHandlers(server, deps)
  registerMessagingHandlers(runtimeServer, deps)
}
