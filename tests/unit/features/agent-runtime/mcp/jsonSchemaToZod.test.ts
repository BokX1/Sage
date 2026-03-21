import { describe, expect, it } from 'vitest';

import { convertJsonSchemaToZod } from '../../../../../src/features/agent-runtime/mcp/jsonSchemaToZod';

describe('convertJsonSchemaToZod', () => {
  it('converts provider-safe object schemas into strict zod objects', () => {
    const validator = convertJsonSchemaToZod({
      type: 'object',
      properties: {
        repo: { type: 'string', minLength: 3 },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['repo'],
      additionalProperties: false,
    });

    expect(validator.parse({ repo: 'sage', limit: 4 })).toEqual({ repo: 'sage', limit: 4 });
    expect(() => validator.parse({ repo: 'sa' })).toThrow(/>=3 characters/);
    expect(() => validator.parse({ repo: 'sage', extra: true })).toThrow(/Unrecognized key/);
  });

  it('rejects unsupported schema keywords instead of coercing them loosely', () => {
    expect(() =>
      convertJsonSchemaToZod({
        type: 'object',
        oneOf: [{ type: 'object' }],
      }),
    ).toThrow(/unsupported schema keyword "oneOf"/);
  });

  it('rejects top-level schemas that are not objects', () => {
    expect(() =>
      convertJsonSchemaToZod({
        type: 'string',
      }),
    ).toThrow(/top-level schema must convert to a Zod object/);
  });
});
