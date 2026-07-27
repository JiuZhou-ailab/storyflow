// input: Skills RPC requests routed through a Free or Project Conversation runtime
// output: Global Skill listings, creation, deletion, and local open actions
// pos: Server boundary routing clients to the runtime-global Skill store

import { join } from 'path'
import { readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { resolveRuntimeWorkspace } from '@craft-agent/shared/workspaces'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
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

  // workspaceId routes to the owning runtime; Skills are global within it.
  // workingDirectory remains in the RPC signature for client compatibility.
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    void workingDirectory
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = loadAllSkills()
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills for runtime ${workspace.id}`)
    return skills
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    await assertSkillSlug(skillSlug)
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { loadSkill } = await import('@craft-agent/shared/skills')
    const skillDir = loadSkill(skillSlug)?.path
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

  // Delete a global Skill.
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    await assertSkillSlug(skillSlug)
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill } = await import('@craft-agent/shared/skills')
    if (!deleteSkill(skillSlug)) throw new Error('Skill not found or cannot be deleted')
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    await assertSkillSlug(skillSlug)
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { loadSkill } = await import('@craft-agent/shared/skills')
    const skill = loadSkill(skillSlug)
    if (!skill) throw new Error('Skill not found')
    const skillFile = join(skill.path, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    await assertSkillSlug(skillSlug)
    const workspace = resolveRuntimeWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { loadSkill } = await import('@craft-agent/shared/skills')
    const skill = loadSkill(skillSlug)
    if (!skill) throw new Error('Skill not found')
    await deps.platform.showItemInFolder?.(skill.path)
  })
}
