// input: Storyflow pre-tool and post-tool callbacks
// output: Pi-native tool_call and tool_result Extension hooks
// pos: Lifecycle adapter between Pi tool execution and Storyflow governance

import type {
  InlineExtension,
  ToolCallEvent,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';

export function createToolHooks(options: {
  onTurnStart?(): void;
  beforeToolCall(event: ToolCallEvent): Promise<Record<string, unknown>>;
  afterToolCall(event: ToolResultEvent): Promise<{
    content?: (TextContent | ImageContent)[];
    details?: unknown;
    isError?: boolean;
  } | void>;
}): InlineExtension {
  return {
    name: 'storyflow-tool-hooks',
    factory(pi) {
      if (options.onTurnStart) pi.on('turn_start', options.onTurnStart);
      pi.on('tool_call', async (event) => {
        const nextInput = { ...await options.beforeToolCall(event) };
        const input = event.input as Record<string, unknown>;
        for (const key of Object.keys(input)) delete input[key];
        Object.assign(input, nextInput);
      });
      pi.on('tool_result', options.afterToolCall);
    },
  };
}
