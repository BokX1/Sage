/**
 * @module src/core/utils/json-schema
 * @description Defines the json schema module.
 */
function sanitizeJsonSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonSchemaValue);
  }

  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(input)) {
      if (key === '$schema') {
        continue;
      }
      output[key] = sanitizeJsonSchemaValue(nestedValue);
    }

    return output;
  }

  return value;
}

/**
 * Remove schema-meta fields that some OpenAI-compatible providers reject.
 */
export function sanitizeJsonSchemaForProvider<T>(schema: T): T {
  return sanitizeJsonSchemaValue(schema) as T;
}
