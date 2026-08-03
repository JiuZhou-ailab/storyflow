// input: Pi SDK tool schemas and malformed model-emitted tool arguments.
// output: Canonical executable arguments for Pi built-in tools.
// pos: Narrow compatibility adapter before Pi tool argument validation.

const PI_BUILTIN_TOOL_NAMES = new Set([
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'find',
  'ls',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSchemaAliasValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) || isRecord(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

/**
 * Normalize model-emitted underscored aliases before Pi validates tool arguments.
 *
 * This is intentionally schema-driven: Craft's display wrapper may render
 * fields as `_field`, but Pi's built-in tools remain canonical and validate
 * against `field`. Only root properties declared by the current Pi tool schema
 * are mapped, and existing canonical values win over aliases.
 */
export function normalizeCraftToolArgumentsForSchema<T>(
  toolName: string,
  schema: unknown,
  input: T,
): T {
  if (!PI_BUILTIN_TOOL_NAMES.has(toolName.toLowerCase())) return input;
  if (!isRecord(input) || !isRecord(schema)) return input;

  const properties = schema.properties;
  if (!isRecord(properties)) return input;

  let normalized: Record<string, unknown> | undefined;

  for (const key of Object.keys(properties)) {
    const aliasKey = `_${key}`;
    const source = normalized ?? input;
    if (!(aliasKey in source)) continue;

    normalized ??= { ...input };
    if (!(key in normalized)) {
      normalized[key] = parseSchemaAliasValue(normalized[aliasKey]);
    }
    delete normalized[aliasKey];
  }

  return (normalized ?? input) as T;
}
