import { describe, it, expect } from 'vitest';
import { modelSupports, ModelInfo } from '../../../src/core/llm/modelCatalog';

describe('modelSupports', () => {
  it('treats vision capability as satisfied by caps.vision', () => {
    const info: ModelInfo = {
      id: 'vision-model',
      caps: { vision: true },
    };

    expect(modelSupports(info, { vision: true })).toBe(true);
  });

  it('treats vision capability as satisfied by input modalities', () => {
    const info: ModelInfo = {
      id: 'vision-model',
      caps: {},
      inputModalities: ['text', 'image'],
    };

    expect(modelSupports(info, { vision: true })).toBe(true);
  });

  it('rejects vision requirement when no vision support is present', () => {
    const info: ModelInfo = {
      id: 'text-only',
      caps: { vision: false },
      inputModalities: ['text'],
    };

    expect(modelSupports(info, { vision: true })).toBe(false);
  });
});
