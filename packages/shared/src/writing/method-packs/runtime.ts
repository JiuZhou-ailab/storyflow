// input: Method Pack runtime metadata
// output: Agent-facing preamble text for a project method environment
// pos: Minimal adapter before Method Pack context is wired into agent prompt assembly

import type { MethodPack } from "./types.ts";

export function buildMethodPackRuntimePreamble(pack: MethodPack): string {
  return pack.runtimePreamble;
}
