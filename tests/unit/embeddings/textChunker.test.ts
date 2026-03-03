/**
 * @description Validates text chunker normalization and edge-case behavior.
 */
import { describe, expect, it } from 'vitest';
import { chunkText } from '../../../src/core/embeddings/textChunker';

describe('textChunker', () => {
  it('returns no chunks for blank input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('normalizes invalid chunk sizing inputs safely', () => {
    const text = 'word '.repeat(700);
    const chunks = chunkText(text, 0, Number.NaN as unknown as number);

    expect(chunks.length).toBeGreaterThan(0);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
      expect(chunks[i].content.length).toBeGreaterThan(0);
      expect(chunks[i].tokenCount).toBeGreaterThan(0);
    }
  });

  it('clamps overlap larger than chunk size', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    const chunks = chunkText(text, 2, 500);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });
});
