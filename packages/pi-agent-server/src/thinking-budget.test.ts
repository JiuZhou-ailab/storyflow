// input: Real Pi Anthropic and Bedrock request serializers, with dispatch stopped before network IO
// output: Valid thinking parameters within the caller's combined response budget
// pos: Regression boundary for small and context-clamped output budgets
import { expect, test } from 'bun:test';
import { streamSimple as anthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as bedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream';

for (const api of ['anthropic-messages', 'bedrock-converse-stream'] as const) {
  for (const [maxTokens, contextWindow] of [[1, 200000], [1024, 200000], [1536, 200000], [2048, 200000], [8192, 200000], [8192, 5000]] as const) {
    test(`${api} fits valid thinking inside ${maxTokens} output tokens with a ${contextWindow} window`, async () => {
      const model = {
        api, provider: 'fixture', id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5',
        baseUrl: 'http://127.0.0.1:1', reasoning: true, input: ['text'] as ['text'],
        contextWindow, maxTokens: 64000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
      let payload: any;
      const stream = api === 'anthropic-messages' ? anthropic : bedrock;
      const result = await stream(model as never, {
        messages: [{ role: 'user', content: 'Reply OK', timestamp: 1 }],
      }, {
        apiKey: 'local-fixture-only', reasoning: 'medium', maxTokens,
        onPayload(body) { payload = body; throw new Error('Captured before dispatch'); },
      }).result();
      expect(result.errorMessage).toContain('Captured before dispatch');
      expect(payload).toBeDefined();
      const effectiveMax = payload.max_tokens ?? payload.inferenceConfig.maxTokens;
      if (contextWindow === 5000) expect(effectiveMax).toBeLessThan(1024);
      else expect(effectiveMax).toBe(maxTokens);
      const thinking = payload.thinking ?? payload.additionalModelRequestFields?.thinking;
      if (effectiveMax < 2048) expect(thinking?.type).not.toBe('enabled');
      else {
        expect(thinking.type).toBe('enabled');
        expect(thinking.budget_tokens).toBeGreaterThanOrEqual(1024);
        expect(thinking.budget_tokens).toBeLessThan(effectiveMax);
      }
    });
  }
}
