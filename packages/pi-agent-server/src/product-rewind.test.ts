// input: Visible and hidden Storyflow prompt boundaries represented as Pi custom entries
// output: Regression checks for stable ID-based rewind mapping
// pos: Guards against reintroducing ordinal-based Pi/product transcript coupling

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import {
  PRODUCT_REWIND_BOUNDARY_TYPE,
  PRODUCT_TREE_HEAD_TYPE,
  createProductRewindBoundary,
  findProductRewindBoundary,
} from './product-rewind.ts';

const userEntry = (id: string): SessionEntry => ({
  type: 'message',
  id,
  parentId: null,
  timestamp: new Date(0).toISOString(),
  message: { role: 'user', content: 'prompt', timestamp: 0 },
});

describe('product rewind mapping', () => {
  it('binds the latest Pi user entry to a product cut boundary without ordinals', () => {
    expect(createProductRewindBoundary([userEntry('pi-user-1')], {
      visibleUserMessageId: 'product-user-1',
      retainThroughMessageId: 'product-assistant-0',
      draftText: 'rewrite this',
    })).toEqual({
      v: 1,
      userEntryId: 'pi-user-1',
      visibleUserMessageId: 'product-user-1',
      retainThroughMessageId: 'product-assistant-0',
      draftText: 'rewrite this',
    });
  });

  it('resolves hidden prompts by Pi entry id while retaining the prior product boundary', () => {
    const mapping = createProductRewindBoundary([userEntry('pi-hidden')], {
      retainThroughMessageId: 'product-assistant-1',
    })!;
    const entries: SessionEntry[] = [userEntry('pi-hidden'), {
      type: 'custom',
      customType: PRODUCT_REWIND_BOUNDARY_TYPE,
      data: mapping,
      id: 'mapping-1',
      parentId: 'pi-hidden',
      timestamp: new Date(0).toISOString(),
    }];

    expect(findProductRewindBoundary(entries, { userEntryId: 'pi-hidden' })).toEqual(mapping);
    expect(findProductRewindBoundary(entries, { visibleUserMessageId: 'missing' })).toBeUndefined();
  });

  it('persists a navigated Pi leaf across process restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'storyflow-tree-head-'));
    try {
      const manager = SessionManager.create(root, join(root, 'sessions'));
      const firstUser = manager.appendMessage({ role: 'user', content: 'first', timestamp: 0 });
      const firstAssistant = manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: 0,
      });
      const abandonedUser = manager.appendMessage({ role: 'user', content: 'second', timestamp: 1 });

      manager.branch(firstAssistant);
      const treeHead = manager.appendCustomEntry(PRODUCT_TREE_HEAD_TYPE, { v: 1 });

      const reopened = SessionManager.open(manager.getSessionFile()!);
      expect(reopened.getLeafId()).toBe(treeHead);
      expect(reopened.getBranch().map(entry => entry.id)).toContain(firstUser);
      expect(reopened.getBranch().map(entry => entry.id)).not.toContain(abandonedUser);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
