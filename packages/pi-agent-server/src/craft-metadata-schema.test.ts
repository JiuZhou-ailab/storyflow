// input: Pi SDK tool schemas and malformed model-emitted tool arguments.
// output: Regression coverage for canonical Pi tool arguments.
// pos: Unit tests for the Pi subprocess argument adapter.

import { describe, expect, it } from 'bun:test';
import {
  createBashToolDefinition,
  createEditToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { normalizeCraftToolArgumentsForSchema } from './craft-metadata-schema.ts';

describe('Pi tool argument compatibility', () => {
  it('normalizes underscored built-in aliases from the Pi tool schema before SDK validation', () => {
    const bashTool = createBashToolDefinition('/tmp');
    const bashArguments = normalizeCraftToolArgumentsForSchema(
      bashTool.name,
      bashTool.parameters,
      { _command: 'ls /tmp' },
    );

    expect(bashArguments).toEqual({ command: 'ls /tmp' });
    expect(validateToolArguments(bashTool, {
      type: 'toolCall',
      id: 'call_bash',
      name: 'bash',
      arguments: bashArguments,
    })).toEqual(bashArguments);

    const editTool = createEditToolDefinition('/tmp');
    const malformed = {
      _path: '/tmp/story.md',
      _edits: JSON.stringify([{ oldText: 'old', newText: 'new' }]),
    };

    const normalized = normalizeCraftToolArgumentsForSchema(
      editTool.name,
      editTool.parameters,
      malformed,
    );

    expect(normalized).toEqual({
      path: '/tmp/story.md',
      edits: [{ oldText: 'old', newText: 'new' }],
    });
    expect(validateToolArguments(editTool, {
      type: 'toolCall',
      id: 'call_edit',
      name: 'edit',
      arguments: normalized,
    })).toEqual(normalized);
    expect(malformed).toHaveProperty('_edits');
    expect(malformed).toHaveProperty('_path');
  });

  it('does not let underscored aliases override canonical schema fields', () => {
    const bashTool = createBashToolDefinition('/tmp');
    const input = {
      command: 'pwd',
      _command: 'rm -rf /tmp/nope',
    };

    const normalized = normalizeCraftToolArgumentsForSchema(
      bashTool.name,
      bashTool.parameters,
      input,
    );

    expect(normalized).toEqual({ command: 'pwd' });
    expect(input).toHaveProperty('_command', 'rm -rf /tmp/nope');
  });

  it('does not normalize underscored aliases for non-built-in tools', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    };
    const input = { _query: 'status' };

    expect(normalizeCraftToolArgumentsForSchema('web_search', schema, input)).toBe(input);
  });
});
