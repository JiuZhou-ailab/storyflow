// input: Pi session entries plus one Storyflow product transcript boundary
// output: Durable Pi-user-entry to product-cut mapping for safe tree rewind
// pos: Minimal identity contract between Pi-owned session trees and Storyflow-owned messages

import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type {
  ConversationRewindBoundary,
  ConversationRewindResult,
} from '../../shared/src/agent/backend/types.ts';

export const PRODUCT_REWIND_BOUNDARY_TYPE = 'storyflow-product-rewind-boundary';
export const PRODUCT_TREE_HEAD_TYPE = 'storyflow-product-tree-head';

export interface ProductRewindBoundary {
  v: 1;
  userEntryId: string;
  visibleUserMessageId?: string;
  retainThroughMessageId: string | null;
  draftText?: string;
}

export type PendingProductRewindBoundary = Omit<ProductRewindBoundary, 'v' | 'userEntryId'>;

export function createProductRewindBoundary(
  branch: readonly SessionEntry[],
  pending: PendingProductRewindBoundary,
): ProductRewindBoundary | undefined {
  const latestUserEntry = [...branch].reverse().find(
    entry => entry.type === 'message' && entry.message.role === 'user',
  );
  if (!latestUserEntry) return undefined;
  return { v: 1, userEntryId: latestUserEntry.id, ...pending };
}

export function findProductRewindBoundary(
  entries: readonly SessionEntry[],
  match: { userEntryId?: string; visibleUserMessageId?: string },
): ProductRewindBoundary | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== 'custom' || entry.customType !== PRODUCT_REWIND_BOUNDARY_TYPE) continue;
    const data = entry.data as Partial<ProductRewindBoundary> | undefined;
    if (
      data?.v !== 1
      || typeof data.userEntryId !== 'string'
      || !('retainThroughMessageId' in data)
    ) continue;
    if (match.userEntryId && data.userEntryId !== match.userEntryId) continue;
    if (match.visibleUserMessageId && data.visibleUserMessageId !== match.visibleUserMessageId) continue;
    return data as ProductRewindBoundary;
  }
  return undefined;
}

export async function executeProductRewind<T extends { cancelled: boolean }>(
  boundary: ConversationRewindBoundary,
  actions: {
    prepare: (boundary: ConversationRewindBoundary) => Promise<Extract<ConversationRewindResult, { phase: 'prepared' }>>;
    navigate: () => Promise<T>;
    currentLeaf: () => string | null;
    restoreLeaf: (leafId: string | null) => Promise<void>;
    appendHead: () => void;
    commit: (prepared: Extract<ConversationRewindResult, { phase: 'prepared' }>) => Promise<void>;
    abort: (token: string) => Promise<void>;
  },
): Promise<T> {
  const prepared = await actions.prepare(boundary);
  const oldLeafId = actions.currentLeaf();
  let forwardHeadPersisted = false;

  const compensate = async (): Promise<unknown[]> => {
    const failures: unknown[] = [];
    try {
      if (actions.currentLeaf() !== oldLeafId) await actions.restoreLeaf(oldLeafId);
      if (forwardHeadPersisted) actions.appendHead();
    } catch (error) {
      failures.push(error);
    }
    try {
      await actions.abort(prepared.token);
    } catch (error) {
      failures.push(error);
    }
    return failures;
  };

  let result: T;
  try {
    result = await actions.navigate();
    if (!result.cancelled) {
      actions.appendHead();
      forwardHeadPersisted = true;
      await actions.commit(prepared);
    }
  } catch (error) {
    const failures = [error, ...await compensate()];
    if (failures.length > 1) throw new AggregateError(failures, 'Failed to rewind and restore Pi session');
    throw error;
  }
  if (result.cancelled) {
    const failures = await compensate();
    if (failures.length) throw new AggregateError(failures, 'Failed to abort cancelled rewind');
  }
  return result;
}
