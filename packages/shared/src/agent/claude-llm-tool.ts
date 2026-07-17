// input: Claude adapter callbacks and call_llm tool arguments
// output: A Claude SDK tool wrapper delegating model work to the active backend
// pos: Legacy Claude adapter boundary kept out of the Pi runtime dependency graph

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { getDefaultSummarizationModel, getModelById, MODEL_REGISTRY } from '../config/models.ts';
import {
  MAX_ATTACHMENTS,
  MAX_TOTAL_CONTENT_BYTES,
  OUTPUT_FORMATS,
  processAttachment,
  type LLMQueryRequest,
  type LLMQueryResult,
} from './llm-tool.ts';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

const AttachmentSchema = z.union([
  z.string().describe('Simple file path'),
  z.object({
    path: z.string().describe('File path'),
    startLine: z.number().int().min(1).optional().describe('First line to include (1-indexed)'),
    endLine: z.number().int().min(1).optional().describe('Last line to include (1-indexed)'),
  }).describe('File path with optional line range for large files'),
]);

const OutputSchemaParam = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).optional(),
}).describe('JSON Schema for structured output');

export interface LLMToolOptions {
  sessionId: string;
  sessionPath?: string;
  getQueryFn: () => ((request: LLMQueryRequest) => Promise<LLMQueryResult>) | undefined;
}

function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export function createLLMTool(options: LLMToolOptions) {
  const { sessionId: _sessionId } = options;

  return tool(
    'call_llm',
    `Invoke a secondary LLM for focused subtasks. Use for:
- Cost optimization: use a smaller model for simple tasks (summarization, classification)
- Structured output: JSON schema compliance via native backend support
- Parallel processing: call multiple times in one message - all run simultaneously
- Context isolation: process content without polluting main context

Put text/content directly in the 'prompt' parameter. Do NOT pass inline text via attachments.
Only use 'attachments' for existing file paths on disk - the tool loads file content automatically.
For large files (>2000 lines), use {path, startLine, endLine} to select a portion.`,
    {
      prompt: z.string().min(1, 'Prompt cannot be empty').describe('Instructions for the LLM'),
      attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS).optional()
        .describe(`File paths on disk (max ${MAX_ATTACHMENTS}). NOT for inline text — put text in prompt instead. Use {path, startLine, endLine} for large files.`),
      model: z.string().optional().describe('Model ID or short name (e.g., "haiku", "sonnet"). Defaults to a fast model.'),
      systemPrompt: z.string().optional().describe('Optional system prompt'),
      maxTokens: z.number().int().min(1).max(64000).optional().describe('Max output tokens (1-64000). Defaults to 4096'),
      temperature: z.number().min(0).max(1).optional().describe('Sampling temperature 0-1'),
      outputFormat: z.enum(['summary', 'classification', 'extraction', 'analysis', 'comparison', 'validation']).optional()
        .describe('Predefined output format'),
      outputSchema: OutputSchemaParam.optional().describe('Custom JSON Schema for structured output'),
    },
    async (args) => {
      if (!args.prompt?.trim()) return errorResponse('Prompt is required and cannot be empty.');
      if (args.outputFormat && args.outputSchema) {
        return errorResponse(
          'Cannot use both outputFormat and outputSchema.\n\n' +
          'Options:\n' +
          '1. Use outputFormat for predefined schemas (summary, classification, etc.)\n' +
          '2. Use outputSchema for custom JSON Schema',
        );
      }

      if (args.model) {
        let modelDef = getModelById(args.model);
        if (!modelDef) {
          modelDef = MODEL_REGISTRY.find(m => m.shortName.toLowerCase() === args.model!.toLowerCase())
            || MODEL_REGISTRY.find(m => m.name.toLowerCase() === args.model!.toLowerCase());
          if (modelDef) {
            args.model = modelDef.id;
          } else {
            const available = MODEL_REGISTRY.map(m => `  - ${m.id} (${m.shortName})`).join('\n');
            return errorResponse(`Unknown model: "${args.model}"\n\nAvailable models:\n${available}`);
          }
        }
      }

      const queryFn = options.getQueryFn();
      if (!queryFn) {
        return errorResponse('No authentication configured for call_llm.\n\nSign in with your AI provider to use this tool.');
      }

      const textParts: string[] = [];
      let totalContentBytes = 0;
      if (args.attachments?.length) {
        for (let i = 0; i < args.attachments.length; i++) {
          const result = await processAttachment(args.attachments[i]!, i, options.sessionPath);
          if (result.type === 'error') return errorResponse(result.message);
          if (result.type === 'image') {
            return errorResponse(`Attachment ${i + 1}: Image attachments are not supported. Use text files only.`);
          }
          totalContentBytes += result.bytes;
          if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) {
            return errorResponse(
              `Total attachment size exceeds ${MAX_TOTAL_CONTENT_BYTES / 1_000_000}MB limit.\n\n` +
              'Use line ranges, split the call, or remove attachments.',
            );
          }
          textParts.push(`<file path="${result.filename}">\n${result.content}\n</file>`);
        }
      }
      textParts.push(args.prompt);

      const model = args.model || getDefaultSummarizationModel();
      const schema = args.outputSchema || (args.outputFormat ? OUTPUT_FORMATS[args.outputFormat] : null);
      try {
        const result = await queryFn({
          prompt: textParts.join('\n\n'),
          systemPrompt: args.systemPrompt || undefined,
          model,
          maxTokens: args.maxTokens,
          temperature: args.temperature,
          outputSchema: schema ? (schema as Record<string, unknown>) : undefined,
        });
        if (!result.text && !result.warning) {
          return { content: [{ type: 'text' as const, text: '(Model returned empty response)' }] };
        }
        const body = result.warning
          ? `[Partial result — ${result.warning}]\n\n${result.text || '(no text produced before stop)'}`
          : result.text;
        return { content: [{ type: 'text' as const, text: body }] };
      } catch (error) {
        if (error instanceof Error) return errorResponse(`call_llm failed: ${error.message}`);
        throw error;
      }
    },
    { annotations: { readOnlyHint: true } },
  );
}
