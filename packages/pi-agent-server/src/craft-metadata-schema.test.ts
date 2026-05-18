// input: Pi SDK tool schemas and malformed model-emitted tool arguments.
// output: Regression coverage for Craft metadata and tool argument compatibility.
// pos: Unit tests for the Pi subprocess schema and argument adapters.

import { describe, expect, it } from 'bun:test';
import {
  createBashToolDefinition,
  createEditToolDefinition,
} from '@mariozechner/pi-coding-agent';
import { validateToolArguments } from '@mariozechner/pi-ai';
import {
  allowCraftMetadataProperties,
  allowCraftMetadataPropertiesForTool,
  normalizeCraftToolArgumentsForSchema,
  stripCraftMetadata,
} from './craft-metadata-schema.ts';

describe('Craft metadata schema compatibility for Pi tools', () => {
  it('widens a strict Edit-like schema with optional Craft metadata properties', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              oldText: { type: 'string' },
              newText: { type: 'string' },
            },
            required: ['oldText', 'newText'],
          },
        },
      },
      required: ['path', 'edits'],
    };

    const widened = allowCraftMetadataProperties(schema);

    expect(widened).not.toBe(schema);
    expect(widened.additionalProperties).toBe(false);
    expect(widened.required).toEqual(schema.required);
    expect(widened.required).not.toContain('_displayName');
    expect(widened.required).not.toContain('_intent');
    expect(widened.properties._displayName).toBeDefined();
    expect(widened.properties._intent).toBeDefined();
    expect(widened.properties.path).toBe(schema.properties.path);
    expect(widened.properties.edits).toBe(schema.properties.edits);
  });

  it('keeps actual Pi Edit tool schema canonical for model-visible built-in tools', () => {
    const editTool = createEditToolDefinition('/tmp');
    const schema = allowCraftMetadataPropertiesForTool(editTool.name, editTool.parameters);
    const toolSchema = schema as {
      additionalProperties?: unknown;
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(schema).toBe(editTool.parameters);
    expect(toolSchema.additionalProperties).toBe(false);
    expect(toolSchema.properties._displayName).toBeUndefined();
    expect(toolSchema.properties._intent).toBeUndefined();
    expect(toolSchema.required ?? []).not.toContain('_displayName');
    expect(toolSchema.required ?? []).not.toContain('_intent');
  });

  it('widens non-built-in tool schemas for Craft metadata compatibility', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    };

    const widened = allowCraftMetadataPropertiesForTool('web_search', schema);

    expect(widened).not.toBe(schema);
    expect(widened.properties._displayName).toBeDefined();
    expect(widened.properties._intent).toBeDefined();
    expect(widened.required).toEqual(['query']);
  });

  it('preserves upstream metadata properties if Pi defines them later', () => {
    const upstreamDisplayName = { type: 'string', description: 'upstream display name' };
    const upstreamIntent = { type: 'string', description: 'upstream intent' };
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        _displayName: upstreamDisplayName,
        _intent: upstreamIntent,
        path: { type: 'string' },
      },
      required: ['path'],
    };

    const widened = allowCraftMetadataProperties(schema);

    expect(widened.properties._displayName).toBe(upstreamDisplayName);
    expect(widened.properties._intent).toBe(upstreamIntent);
  });

  it('returns unknown schema shapes unchanged', () => {
    expect(allowCraftMetadataProperties(undefined)).toBeUndefined();
    expect(allowCraftMetadataProperties('schema')).toBe('schema');

    const noProperties = { type: 'string' };
    expect(allowCraftMetadataProperties(noProperties)).toBe(noProperties);
  });

  it('strips Craft metadata before upstream Pi tool execution', () => {
    const input = {
      _displayName: 'Edit Lines',
      _intent: 'Add punctuation',
      path: 'random',
      edits: [{ oldText: 'a', newText: 'b' }],
    };

    const clean = stripCraftMetadata(input);

    expect(clean).toEqual({
      path: 'random',
      edits: [{ oldText: 'a', newText: 'b' }],
    });
    expect(clean).not.toHaveProperty('_displayName');
    expect(clean).not.toHaveProperty('_intent');
    expect(input).toHaveProperty('_displayName', 'Edit Lines');
    expect(input).toHaveProperty('_intent', 'Add punctuation');
  });

  it('returns the same input object when no metadata is present', () => {
    const input = { path: 'random' };
    expect(stripCraftMetadata(input)).toBe(input);
  });

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
