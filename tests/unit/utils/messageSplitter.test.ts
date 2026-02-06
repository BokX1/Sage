import { describe, expect, it } from 'vitest';
import { smartSplit } from '../../../src/core/utils/message-splitter';

describe('smartSplit', () => {

  it('throws when maxLength is not a positive integer', () => {
    expect(() => smartSplit('hello', 0)).toThrow(RangeError);
    expect(() => smartSplit('hello', -2)).toThrow('maxLength must be a positive integer');
    expect(() => smartSplit('hello', 2.5)).toThrow(RangeError);
    expect(() => smartSplit('hello', Number.NaN)).toThrow(RangeError);
  });
  it('closes and reopens code fences across chunks', () => {
    const input = [
      '```typescript',
      'const alpha = 1;',
      'const beta = 2;',
      'const gamma = 3;',
      '```',
    ].join('\n');

    const parts = smartSplit(input, 30);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain('```');
    expect(parts[0].trim().endsWith('```')).toBe(true);
    expect(parts[1].startsWith('```typescript')).toBe(true);
  });

  it('prefers newline or space boundaries when splitting', () => {
    const input = 'first line\nsecond line with words';
    const parts = smartSplit(input, 12);

    expect(parts[0]).toBe('first line');
    expect(parts[1].startsWith('second line')).toBe(true);
  });
});
