// input: Skills RPC requests routed through a Free or Project Conversation runtime
// output: Pi-native Skill listings, exact package export, user creation, safe deletion, and local open actions
// pos: Server boundary projecting the active project's Pi Skill catalog

import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { readdirSync, rmSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { resolveRuntimeWorkspace } from '@craft-agent/shared/workspaces'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.EXPORT,
  RPC_CHANNELS.skills.CREATE,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const assertSkillSlug = async (skillSlug: string): Promise<void> => {
    const { isValidSkillSlug } = await import('@craft-agent/shared/skills')
    if (!isValidSkillSlug(skillSlug)) throw new Error('Invalid Skill slug')
  }

  const loadWorkspaceCatalog = async (
    workspace: NonNullable<ReturnType<typeof resolveRuntimeWorkspace>>,
    workingDirectory?: string,
  ) => {
    const { loadPiSkillCatalog } = await import('@craft-agent/shared/skills')
    const workspaceRoot = resolve(workspace.rootPath)
    const catalogCwd = resolve(workingDirectory || workspaceRoot)
    const relativeCwd = relative(workspaceRoot, catalogCwd)
    if (relativeCwd.startsWith('..') || isAbsolute(relativeCwd)) {
      throw new Error('Skill working directory must be inside the workspace')
    }
    return loadPiSkillCatalog(catalogCwd)
  }

  const findWorkspaceSkill = async (
    workspace: NonNullable<ReturnType<typeof resolveRuntimeWorkspace>>,
    skillSlug: string,
  ) => {
    const catalog = await loadWorkspaceCatalog(workspace)
    return catalog.skills.find(skill => skill.slug === skillSlug) ?? null
  }

  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    const catalog = await loadWorkspaceCatalog(workspace, workingDirectory)
    const skills = catalog.skills
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills for runtime ${workspace.id}`)
    for (const diagnostic of catalog.diagnostics) {
      deps.platform.logger?.warn(`SKILLS_GET: ${diagnostic.message}`, diagnostic)
    }
    return skills
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const skillDir = (await findWorkspaceSkill(workspace, skillSlug))?.path
    if (!skillDir) return []

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        deps.platform.logger?.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  server.handle(RPC_CHANNELS.skills.EXPORT, async (
    _ctx,
    workspaceId: string,
    skillSlug: string,
    workingDirectory?: string,
  ) => {
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const catalog = await loadWorkspaceCatalog(workspace, workingDirectory)
    const skill = catalog.skills.find(candidate => candidate.slug === skillSlug)
    if (!skill) throw new Error('Skill not found in the resolved Pi catalog')
    if (skill.origin !== 'top-level') {
      throw new Error('Packaged Skills must be published by their package owner')
    }

    const { exportResources } = await import('@craft-agent/shared/resources')
    const result = exportResources(
      workspace.rootPath,
      { skills: [basename(skill.path)] },
      dirname(skill.path),
    )
    if (result.bundle.resources.skills?.length !== 1) {
      throw new Error(result.warnings[0] ?? 'Skill could not be exported')
    }
    return result
  })

  server.handle(RPC_CHANNELS.skills.CREATE, async (
    _ctx,
    workspaceId: string,
    skillSlug: string,
    content: string,
  ) => {
    await assertSkillSlug(skillSlug)
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createSkill } = await import('@craft-agent/shared/skills')
    const skill = createSkill(skillSlug, content)
    deps.platform.logger?.info(`Created global Skill: ${skillSlug}`)
    return skill
  })

  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const skill = await findWorkspaceSkill(workspace, skillSlug)
    if (!skill) throw new Error('Skill not found')
    if (skill.origin === 'package') throw new Error('Packaged Skills must be removed with their package manager')

    const target = basename(skill.filePath) === 'SKILL.md'
      ? skill.path
      : skill.filePath
    rmSync(target, { recursive: true })
    const { invalidateSkillsCache } = await import('@craft-agent/shared/skills')
    invalidateSkillsCache()
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const skill = await findWorkspaceSkill(workspace, skillSlug)
    if (!skill) throw new Error('Skill not found')
    await deps.platform.openPath?.(skill.filePath)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const skill = await findWorkspaceSkill(workspace, skillSlug)
    if (!skill) throw new Error('Skill not found')
    await deps.platform.showItemInFolder?.(skill.filePath)
  })
}
