// input: Resolved Source definitions and Host-owned capability references
// output: Exact Source grant keys and currently resolvable granted slugs
// pos: Shared trust contract preventing project-over-global shadowing from inheriting grants

import type { LoadedSource } from './types.ts'

export function getSourceGrantRef(
  source: Pick<LoadedSource, 'origin' | 'config' | 'definitionIdentity'>,
): string {
  return `${source.origin}:${source.config.slug}:${source.definitionIdentity}`
}

export function isSourceHostGranted(
  refs: readonly string[] | undefined,
  source: Pick<LoadedSource, 'origin' | 'config' | 'definitionIdentity'>,
): boolean {
  return refs?.includes(getSourceGrantRef(source)) === true
}

export function resolveHostGrantedSourceSlugs(
  refs: readonly string[] | undefined,
  sources: readonly LoadedSource[],
): string[] {
  return sources
    .filter(source => isSourceHostGranted(refs, source))
    .map(source => source.config.slug)
}

export function createSourceGrantRefs(
  slugs: readonly string[],
  sources: readonly LoadedSource[],
): string[] {
  const requested = new Set(slugs)
  return sources
    .filter(source => requested.has(source.config.slug))
    .map(getSourceGrantRef)
}
