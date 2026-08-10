// input: Declarative API path templates and tool arguments.
// output: Canonical request paths shared by execution and permission checks.
// pos: Trust-boundary normalizer for API Source routing semantics.

import type { ApiOperationParameter } from './types.ts'

const API_PATH_ORIGIN = 'https://storyflow.invalid'

/** Match WHATWG URL normalization without allowing a path to replace the configured origin. */
export function canonicalizeApiPath(path: string): string {
  const relativePath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${API_PATH_ORIGIN}${relativePath}`)
  return `${url.pathname}${url.search}`
}

/** Resolve required path parameters, then canonicalize the path used by fetch. */
export function resolveApiOperationPath(
  template: string,
  input: Record<string, unknown>,
): string {
  let path = template
  for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
    const name = match[1]!
    const value = input[name]
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing path parameter: ${name}`)
    }
    path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)))
  }
  return canonicalizeApiPath(path)
}

/** Apply declarative defaults once, then materialize the request seen by fetch. */
export function materializeApiOperationRequest(
  template: string,
  parameters: readonly ApiOperationParameter[] | undefined,
  input: Record<string, unknown>,
): { path: string; params: Record<string, unknown> } {
  const params = { ...input }
  for (const parameter of parameters ?? []) {
    if (params[parameter.name] === undefined && parameter.default !== undefined) {
      params[parameter.name] = parameter.default
    }
  }

  const path = resolveApiOperationPath(template, params)
  for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
    delete params[match[1]!]
  }
  return { path, params }
}
