// input: Filesystem paths captured from OS-level drag-and-drop
// output: Local source creation inputs preserving the original data path
// pos: Renderer-side adapter from user-dropped data to reusable source config

import type { CreateSourceInput } from '@craft-agent/shared/sources'

function getBaseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Data Source'
}

function stripExtension(name: string): string {
  const withoutExtension = name.replace(/\.[^.\\/]+$/, '')
  return withoutExtension.trim() || name
}

export function buildDroppedLocalSourceInputs(paths: string[]): CreateSourceInput[] {
  return paths
    .map(path => path.trim())
    .filter(Boolean)
    .map(path => ({
      name: stripExtension(getBaseName(path)),
      provider: 'local',
      type: 'local' as const,
      enabled: true,
      local: { path },
    }))
}
