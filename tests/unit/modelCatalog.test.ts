import { describe, expect, it } from 'vitest';
import { findModelInCatalog, suggestModelIds, type ModelInfo } from '../../src/core/llm/modelCatalog';

describe('modelCatalog helpers', () => {
  it('refreshes catalog when model is missing and refreshIfMissing is true', async () => {
    const baseCatalog: Record<string, ModelInfo> = {
      gemini: { id: 'gemini', caps: {} },
    };
    const refreshedCatalog: Record<string, ModelInfo> = {
      ...baseCatalog,
      deepseek: { id: 'deepseek', caps: {} },
    };

    const result = await findModelInCatalog('deepseek', {
      refreshIfMissing: true,
      loadCatalog: async () => baseCatalog,
      refreshCatalog: async () => refreshedCatalog,
    });

    expect(result.model?.id).toBe('deepseek');
    expect(result.refreshed).toBe(true);
  });

  it('suggests close model matches', () => {
    const catalog: Record<string, ModelInfo> = {
      gemini: { id: 'gemini', caps: {} },
      deepseek: { id: 'deepseek', caps: {} },
      'qwen-coder': { id: 'qwen-coder', caps: {} },
    };

    const suggestions = suggestModelIds('gemni', catalog);
    expect(suggestions).toContain('gemini');
  });
});
