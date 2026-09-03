// input: Pi context/message_end extension events over OpenAI Responses assistant history.
// output: Session-local strip-and-retry recovery for invalid_encrypted_content provider 400s.
// pos: Degradation guard between OpenAI Responses encrypted-reasoning replay and Pi-owned auto-retry.

import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';

const OPENAI_RESPONSES_APIS = new Set([
  'openai-responses',
  'azure-openai-responses',
  'openai-codex-responses',
]);

const ENCRYPTED_CONTENT_ERROR_PATTERN =
  /invalid_encrypted_content|encrypted content[\s\S]*could not be (?:verified|decrypted)/i;

export const ENCRYPTED_CONTENT_RETRY_GUIDANCE =
  'stale encrypted reasoning dropped from context; please retry your request';

export function isEncryptedContentError(errorMessage: string): boolean {
  return ENCRYPTED_CONTENT_ERROR_PATTERN.test(errorMessage);
}

type MessageLike = { role: string; [key: string]: unknown };

function stripReplayIdentity(message: AssistantMessage): AssistantMessage {
  const stripped = message.content.map((block): TextContent | ThinkingContent | ToolCall => {
    if (block.type === 'thinking') {
      const { thinkingSignature: _dropped, ...rest } = block;
      return rest;
    }
    if (block.type === 'text') {
      const { textSignature: _dropped, ...rest } = block;
      return rest;
    }
    if (block.type === 'toolCall') {
      const callIdOnly = block.id.split('|')[0] || block.id;
      return { ...block, id: callIdOnly };
    }
    return block;
  });

  return { ...message, content: stripped };
}

function shouldStrip(message: MessageLike, stripBefore: number): boolean {
  return (
    stripBefore > 0 &&
    message.role === 'assistant' &&
    typeof (message as any).api === 'string' &&
    OPENAI_RESPONSES_APIS.has((message as any).api) &&
    ((message as any).timestamp ?? 0) <= stripBefore
  );
}

export function stripEncryptedReasoning<T extends MessageLike>(messages: T[], stripBefore: number): T[] {
  return messages.map((message) =>
    shouldStrip(message, stripBefore) ? (stripReplayIdentity(message as any as AssistantMessage) as unknown as T) : message,
  );
}

export function createOpenAIEncryptedReasoningCompat(): InlineExtension {
  let stripBefore = 0;

  return {
    name: 'storyflow-openai-encrypted-reasoning-compat',
    factory(pi) {
      pi.on('message_end', (event) => {
        const message = event.message as any;
        if (message.role !== 'assistant' || message.stopReason !== 'error') return;
        if (!isEncryptedContentError(message.errorMessage ?? '')) return;
        stripBefore = Date.now();
        return {
          message: {
            ...message,
            errorMessage: `${message.errorMessage} (${ENCRYPTED_CONTENT_RETRY_GUIDANCE})`,
          },
        };
      });

      pi.on('context', (event) => {
        if (stripBefore === 0) return;
        return { messages: stripEncryptedReasoning(event.messages as any, stripBefore) as any };
      });
    },
  };
}
