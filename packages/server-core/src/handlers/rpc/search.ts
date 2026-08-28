// input: Runtime-scoped search requests and the active transport workspace context
// output: Typed session and document hits owned by that runtime workspace
// pos: Search RPC boundary; prevents application search from crossing runtime domains

import {
  RPC_CHANNELS,
  type WorkspaceSearchRequest,
  type WorkspaceSearchResponse,
} from '@craft-agent/shared/protocol'
import {
  getWorkspaceSessionsPath,
  resolveRuntimeWorkspaceById,
} from '@craft-agent/shared/workspaces'
import {
  SearchUnavailableError,
  searchSessions,
  searchWorkspaceDocuments,
} from '@craft-agent/server-core/services'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { resolveContextWorkspaceId } from './file-workspace-scope'

export const HANDLED_CHANNELS = [RPC_CHANNELS.search.QUERY_WORKSPACE] as const

export function registerSearchHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.search.QUERY_WORKSPACE,
    async (ctx, request: WorkspaceSearchRequest): Promise<WorkspaceSearchResponse> => {
      if (!request || typeof request.query !== 'string') throw new Error('Search query must be a string')
      const query = request.query.trim()
      if (query.length < 2) return { status: 'complete', hits: [] }

      const workspaceId = resolveContextWorkspaceId(ctx, deps)
      if (!workspaceId) throw new Error('Search requires an active workspace')

      const workspace = deps.resolveRuntimeWorkspaceById?.(workspaceId) ?? resolveRuntimeWorkspaceById(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const searchId = request.requestId ?? Date.now().toString(36)
      try {
        const [sessionResults, documentResults, sessions] = await Promise.all([
          searchSessions(query, getWorkspaceSessionsPath(workspace.rootPath), { searchId }),
          searchWorkspaceDocuments(query, workspace.rootPath, { searchId }),
          deps.sessionManager.getSessions(workspace.id),
        ])
        const hiddenSessionIds = new Set(sessions.filter(session => session.hidden).map(session => session.id))

        return {
          status: 'complete',
          hits: [
            ...sessionResults
              .filter(result => !hiddenSessionIds.has(result.sessionId))
              .map(result => ({
                kind: 'session' as const,
                sessionId: result.sessionId,
                matchCount: result.matchCount,
                snippet: result.matches[0]?.snippet ?? '',
              })),
            ...documentResults.map(result => ({
              kind: 'document' as const,
              path: result.path,
              relativePath: result.relativePath,
              lineNumber: result.matches[0]?.lineNumber ?? 1,
              matchCount: result.matchCount,
              snippet: result.matches[0]?.snippet ?? '',
            })),
          ],
        }
      } catch (error) {
        if (error instanceof SearchUnavailableError) {
          deps.platform.logger.warn('[search] Workspace search unavailable', {
            workspaceId,
            searchId,
            reason: error.message,
          })
          return { status: 'unavailable', hits: [], message: error.message }
        }
        throw error
      }
    },
  )
}
