// input: Built-in Method Pack identifiers
// output: Method Pack lookup and public exports
// pos: Registry boundary for creative writing project setup

import { CLAUDE_BOOK_METHOD_PACK } from "./claude-book.ts";
import { CREATIVE_WRITING_METHOD_PACK } from "./creative-writing.ts";
import { CRUCIBLE_METHOD_PACK } from "./crucible.ts";
import { OH_STORY_METHOD_PACK } from "./oh-story.ts";
import type { MethodPack } from "./types.ts";

export * from "./types.ts";
export { CLAUDE_BOOK_METHOD_PACK } from "./claude-book.ts";
export { CREATIVE_WRITING_METHOD_PACK } from "./creative-writing.ts";
export { CRUCIBLE_METHOD_PACK } from "./crucible.ts";
export { OH_STORY_METHOD_PACK } from "./oh-story.ts";
export * from "./draft-contract.ts";
export * from "./runtime.ts";
export * from "./validation.ts";

const BUILT_IN_METHOD_PACKS = [
  CLAUDE_BOOK_METHOD_PACK,
  OH_STORY_METHOD_PACK,
  CRUCIBLE_METHOD_PACK,
  CREATIVE_WRITING_METHOD_PACK,
] as const satisfies readonly MethodPack[];

export function getBuiltInMethodPacks(): readonly MethodPack[] {
  return BUILT_IN_METHOD_PACKS;
}

export function getBuiltInMethodPack(id: string): MethodPack | null {
  return BUILT_IN_METHOD_PACKS.find((pack) => pack.id === id) ?? null;
}
