import { describe, it, expect } from 'vitest';
import {
    modelSupports,
    findModelInCatalog,
    suggestModelIds,
    inferSearchCapabilityFromMetadata,
    type ModelInfo
} from '../../../src/core/llm/model-catalog';

describe('modelCatalog', () => {
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

        it('enforces explicit search capability requirement', () => {
            const searchInfo: ModelInfo = {
                id: 'gemini-search',
                caps: { search: true },
            };
            const plainInfo: ModelInfo = {
                id: 'openai-large',
                caps: {},
            };

            expect(modelSupports(searchInfo, { search: true })).toBe(true);
            expect(modelSupports(plainInfo, { search: true })).toBe(false);
        });
    });

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
                'qwen-coder': { id: 'qwen-coder', caps: {} },
            };

            const suggestions = suggestModelIds('kimi', catalog);
            expect(suggestions).toContain('kimi');
        });

        it('infers search capability from provider metadata text', () => {
            expect(
                inferSearchCapabilityFromMetadata({
                    id: 'gemini-search',
                    aliases: ['gemini-2.5-flash-search'],
                    description: 'Google Gemini with Web Search'
                })
            ).toBe(true);
            expect(
                inferSearchCapabilityFromMetadata({
                    id: 'openai-large',
                    aliases: ['gpt-5.2'],
                    description: 'Most powerful model'
                })
            ).toBe(false);
            expect(
                inferSearchCapabilityFromMetadata({
                    id: 'nomnom',
                    aliases: [],
                    description: 'General model'
                })
            ).toBe(true);
        });
    });
});
