/**
 * @module tests/unit/llm/model-catalog.test
 * @description Defines the model catalog.test module.
 */
import { describe, it, expect } from 'vitest';
import {
    findModelInCatalog,
    suggestModelIds,
    type ModelInfo
} from '../../../src/core/llm/model-catalog';

describe('modelCatalog', () => {

    describe('helpers', () => {
        it('refreshes catalog when model is missing and refreshIfMissing is true', async () => {
            const baseCatalog: Record<string, ModelInfo> = {
                kimi: { id: 'kimi', caps: {} },
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
                kimi: { id: 'kimi', caps: {} },
                deepseek: { id: 'deepseek', caps: {} },

            };

            const suggestions = suggestModelIds('kimi', catalog);
            expect(suggestions).toContain('kimi');
        });

    });
});
