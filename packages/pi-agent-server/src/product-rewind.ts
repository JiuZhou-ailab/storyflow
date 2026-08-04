// input: Pi session entries plus one Storyflow product transcript boundary
// output: Durable Pi-user-entry to product-cut mapping for safe tree rewind
// pos: Minimal identity contract between Pi-owned session trees and Storyflow-owned messages

import type { SessionEntry } from '@earendil-works/pi-coding-agent';

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
