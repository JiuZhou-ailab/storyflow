// input: Workspace identity, portable bundles, verified Skill artifacts, and explicit install scope
// output: Resource import/export plus tracked Skill receipt and upgrade RPCs
// pos: Server-side trust boundary for portable resources and modification-preserving Market upgrades

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getSourceCredentialManager, loadSource } from '@craft-agent/shared/sources'
import { isFreeConversationWorkspaceId } from '@craft-agent/shared/workspaces'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type {
  ResourceBundle,
  ResourceImportMode,
  ResourceImportOptions,
  ExportResourcesOptions,
  SkillInstallArtifact,
  SkillInstallScope,
} from '@craft-agent/shared/resources'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.resources.EXPORT,
  RPC_CHANNELS.resources.IMPORT,
  RPC_CHANNELS.resources.LIST_INSTALL_RECEIPTS,
  RPC_CHANNELS.resources.UPGRADE_SKILL,
] as const

function normalizeSkillScope(workspaceId: string, scope: SkillInstallScope | undefined): SkillInstallScope {
  if (scope !== 'project' && scope !== 'user') {
    throw new Error('Skill operation requires an explicit project or user scope')
  }
  return isFreeConversationWorkspaceId(workspaceId) ? 'user' : scope
}

export function registerResourcesHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Export workspace resources to a portable bundle
  server.handle(
    RPC_CHANNELS.resources.EXPORT,
    async (_ctx, workspaceId: string, options: ExportResourcesOptions) =>
      deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
        const { exportResources } = await import('@craft-agent/shared/resources')
        const { getPiUserSkillsDir } = await import('@craft-agent/shared/skills')
        const skillsRootPath = getPiUserSkillsDir()
        const result = exportResources(workspace.rootPath, options, skillsRootPath)

        deps.platform.logger?.info(
          `RESOURCES_EXPORT: Exported from ${workspaceId}: ` +
          `${result.bundle.resources.sources?.length ?? 0} sources, ` +
          `${result.bundle.resources.skills?.length ?? 0} skills, ` +
          `${result.bundle.resources.automations?.length ?? 0} automations` +
          (result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : ''),
        )

        return result
      }),
  )

  // Import a resource bundle into a workspace
  server.handle(
    RPC_CHANNELS.resources.IMPORT,
    async (
      _ctx,
      workspaceId: string,
      bundle: ResourceBundle,
      mode: ResourceImportMode,
      options: ResourceImportOptions = {},
    ) => deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
      const hasSkills = Boolean(bundle.resources.skills?.length)
      const skillScope = hasSkills ? normalizeSkillScope(workspaceId, options.skillScope) : undefined

      const { importResources } = await import('@craft-agent/shared/resources')
      const { getPiUserSkillsDir } = await import('@craft-agent/shared/skills')
      const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')
      const skillsRootPath = skillScope === 'project'
        ? getWorkspaceSkillsPath(workspace.rootPath)
        : getPiUserSkillsDir()

      const result = await importResources(workspace.rootPath, bundle, mode, {
        // Clear all credential types for a source slug on overwrite
        clearSourceCredentials: async (_wsId: string, sourceSlug: string) => {
          const source = loadSource(workspace.rootPath, sourceSlug, workspace.id)
          if (source) await getSourceCredentialManager().deleteAll(source)
        },
      }, skillsRootPath, hasSkills ? { ...options, skillScope } : options)

      deps.platform.logger?.info(
        `RESOURCES_IMPORT: Imported into ${workspaceId} (mode=${mode}): ` +
        `sources=${result.sources.imported.length} imported, ${result.sources.skipped.length} skipped, ${result.sources.failed.length} failed; ` +
        `skills=${result.skills.imported.length} imported, ${result.skills.skipped.length} skipped, ${result.skills.failed.length} failed; ` +
        `automations=${result.automations.imported.length} imported, ${result.automations.skipped.length} skipped, ${result.automations.failed.length} failed`,
      )

      // Notify ConfigWatcher of imported files so UI refreshes on Linux
      // (Bun's fs.watch doesn't reliably detect atomic renames)
      if (result.automations.imported.length > 0 || result.automations.skipped.length === 0 && bundle.resources.automations?.length) {
        deps.sessionManager.notifyConfigFileChange(workspace.rootPath, 'automations.json')
      }
      for (const slug of result.sources.imported) {
        deps.sessionManager.notifyConfigFileChange(workspace.rootPath, `sources/${slug}/config.json`)
      }
      if (result.skills.imported.length > 0) {
        server.push(RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
      }

      return result
    }),
  )

  server.handle(
    RPC_CHANNELS.resources.LIST_INSTALL_RECEIPTS,
    async (_ctx, workspaceId: string, requestedScope: SkillInstallScope) =>
      deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
        const scope = normalizeSkillScope(workspaceId, requestedScope)
        const { listSkillInstallReceipts } = await import('@craft-agent/shared/resources')
        const { getPiUserSkillsDir } = await import('@craft-agent/shared/skills')
        const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')
        const skillsRootPath = scope === 'project'
          ? getWorkspaceSkillsPath(workspace.rootPath)
          : getPiUserSkillsDir()
        return listSkillInstallReceipts(skillsRootPath).filter(receipt => receipt.scope === scope)
      }),
  )

  server.handle(
    RPC_CHANNELS.resources.UPGRADE_SKILL,
    async (
      _ctx,
      workspaceId: string,
      current: SkillInstallArtifact,
      target: SkillInstallArtifact,
      requestedScope: SkillInstallScope,
    ) => deps.sessionManager.withProjectLifecycle(workspaceId, async workspace => {
      const scope = normalizeSkillScope(workspaceId, requestedScope)
      const { upgradeInstalledSkill } = await import('@craft-agent/shared/resources')
      const { getPiUserSkillsDir } = await import('@craft-agent/shared/skills')
      const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')
      const skillsRootPath = scope === 'project'
        ? getWorkspaceSkillsPath(workspace.rootPath)
        : getPiUserSkillsDir()
      const result = upgradeInstalledSkill(
        skillsRootPath,
        current,
        target,
        scope === 'project'
          ? { scope, projectRootPath: workspace.rootPath }
          : { scope },
      )
      server.push(RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
      deps.platform.logger?.info(
        `RESOURCES_SKILL_UPGRADE: Upgraded ${current.slug} in ${workspaceId} `
        + `(${current.version} -> ${target.version}, preserved=${result.preservedPaths.length})`,
      )
      return result
    }),
  )
}
