import { describe, it, expect } from 'vitest';
import {
    budgetContextBlocks,
    type ContextBlock,
    DEFAULT_TRUNCATION_NOTICE,
} from '../../../src/core/agentRuntime/contextBudgeter';

const estimateTokens = (text: string) => Math.ceil(text.length / 4);
const overheadTokens = 4;

function buildBlocks(overrides: Partial<ContextBlock>[] = []): ContextBlock[] {
    const baseBlocks: ContextBlock[] = [
        {
            id: 'base_system',
            role: 'system',
            content: 'Base system prompt.',
            priority: 100,
            truncatable: false,
        },
        {
            id: 'memory',
            role: 'system',
            content: 'Memory block content.',
            priority: 90,
            truncatable: true,
        },
        {
            id: 'profile_summary',
            role: 'system',
            content: 'Profile summary content.',
            priority: 70,
            truncatable: true,
        },
        {
            id: 'rolling_summary',
            role: 'system',
            content: 'Rolling summary content.',
            priority: 60,
            truncatable: true,
        },
        {
            id: 'transcript',
            role: 'system',
            content: 'Transcript content.',
            priority: 50,
            truncatable: true,
        },
        {
            id: 'reply_context',
            role: 'assistant',
            content: 'Reply context content.',
            priority: 40,
            truncatable: true,
        },
        {
            id: 'user',
            role: 'user',
            content: 'User message content.',
            priority: 110,
            truncatable: true,
        },
    ];

    return baseBlocks.map((block, index) => ({ ...block, ...overrides[index] }));
}

function totalTokens(blocks: ContextBlock[]): number {
    return blocks.reduce((sum, block) => sum + estimateTokens(block.content) + overheadTokens, 0);
}

describe('budgetContextBlocks', () => {
    it('keeps ordering stable', () => {
        const blocks = buildBlocks();

        const result = budgetContextBlocks(blocks, {
            maxInputTokens: 10_000,
            reservedOutputTokens: 0,
            estimateTokens,
        });

        expect(result.map((block) => block.id)).toEqual(blocks.map((block) => block.id));
    });

    it('drops transcript before summaries', () => {
        const transcript = 'T'.repeat(2000);
        const rollingSummary = 'Rolling summary content.';
        const blocks = buildBlocks([
            {},
            {},
            {},
            { content: rollingSummary },
            { content: transcript },
        ]);

        const result = budgetContextBlocks(blocks, {
            maxInputTokens: 200,
            reservedOutputTokens: 0,
            estimateTokens,
        });

        const transcriptBlock = result.find((block) => block.id === 'transcript');
        const rollingBlock = result.find((block) => block.id === 'rolling_summary');

        expect(rollingBlock).toBeDefined();
        expect(transcriptBlock).toBeUndefined();
    });

    it('ensures total tokens fit within budget', () => {
        const blocks = buildBlocks([
            {},
            {},
            {},
            {},
            { content: 'T'.repeat(1000) },
        ]);

        const result = budgetContextBlocks(blocks, {
            maxInputTokens: 150,
            reservedOutputTokens: 25,
            estimateTokens,
        });

        const maxAllowed = 150 - 25;
        expect(totalTokens(result)).toBeLessThanOrEqual(maxAllowed);
    });

    it('keeps user message even under heavy truncation', () => {
        const blocks = buildBlocks([
            { content: 'Base system prompt.'.repeat(50) },
            { content: 'Memory block content.'.repeat(50) },
            { content: 'Profile summary content.'.repeat(50) },
            { content: 'Rolling summary content.'.repeat(50) },
            { content: 'Transcript content.'.repeat(200) },
            { content: 'Reply context content.'.repeat(50) },
            { content: 'User message content.'.repeat(50) },
        ]);

        const result = budgetContextBlocks(blocks, {
            maxInputTokens: 120,
            reservedOutputTokens: 0,
            estimateTokens,
        });

        expect(result.some((block) => block.id === 'user')).toBe(true);
    });

    it('adds truncation notice when truncation occurs', () => {
        const blocks = buildBlocks([
            {},
            {},
            {},
            {},
            { content: 'Transcript content.'.repeat(200) },
        ]);

        const result = budgetContextBlocks(blocks, {
            maxInputTokens: 120,
            reservedOutputTokens: 0,
            estimateTokens,
            truncationNoticeEnabled: true,
            truncationNoticeText: DEFAULT_TRUNCATION_NOTICE,
        });

        const noticeIndex = result.findIndex((block) => block.id === 'trunc_notice');
        const baseIndex = result.findIndex((block) => block.id === 'base_system');

        expect(noticeIndex).toBe(baseIndex + 1);
        expect(result[noticeIndex].content).toBe(DEFAULT_TRUNCATION_NOTICE);
    });
});
