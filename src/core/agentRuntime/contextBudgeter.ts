import { estimateTokens } from './tokenEstimate';

export type ContextBlockId =
    | 'base_system'
    | 'memory'
    | 'profile_summary'
    | 'rolling_summary'
    | 'transcript'
    | 'intent_hint'
    | 'reply_context'
    | 'user'
    | 'trunc_notice';

export type ContextBlock = {
    id: ContextBlockId;
    role: 'system' | 'assistant' | 'user';
    content: string;
    priority: number;
    hardMaxTokens?: number;
    minTokens?: number;
    truncatable: boolean;
};

export type ContextBudgetOptions = {
    maxInputTokens: number;
    reservedOutputTokens: number;
    estimateTokens?: (text: string) => number;
    truncationNoticeEnabled?: boolean;
    truncationNoticeText?: string;
};

const MESSAGE_OVERHEAD_TOKENS = 4;

function estimateBlockTokens(block: ContextBlock, estimator: (text: string) => number): number {
    return estimator(block.content) + MESSAGE_OVERHEAD_TOKENS;
}

function safeTruncateText(text: string, maxTokens: number, estimator: (text: string) => number): string {
    if (maxTokens <= 0) {
        return '';
    }

    let low = 0;
    let high = text.length;
    let best = '';

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = text.slice(0, mid).trimEnd();
        const tokens = estimator(candidate);
        if (tokens <= maxTokens) {
            best = candidate;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return best.trimEnd();
}

function safeTruncateEnd(text: string, maxTokens: number, estimator: (text: string) => number): string {
    if (maxTokens <= 0) {
        return '';
    }

    let low = 0;
    let high = text.length;
    let best = '';

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = text.slice(text.length - mid).trimStart();
        const tokens = estimator(candidate);
        if (tokens <= maxTokens) {
            best = candidate;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return best.trimStart();
}

function truncateBlockContent(
    block: ContextBlock,
    maxTokens: number,
    estimator: (text: string) => number,
): ContextBlock {
    if (maxTokens <= 0) {
        return { ...block, content: '' };
    }

    switch (block.id) {
        case 'transcript':
            return { ...block, content: safeTruncateEnd(block.content, maxTokens, estimator) };
        case 'reply_context':
            return { ...block, content: safeTruncateEnd(block.content, maxTokens, estimator) };
        case 'user': {
            const notice = 'User message truncated to fit context. Showing most recent portion:\\n';
            const noticeTokens = estimator(notice);
            const availableTokens = Math.max(0, maxTokens - noticeTokens);
            const truncatedContent = safeTruncateEnd(block.content, availableTokens, estimator);
            if (truncatedContent.length === block.content.length) {
                return { ...block, content: truncatedContent };
            }
            if (noticeTokens >= maxTokens) {
                return { ...block, content: safeTruncateEnd(block.content, maxTokens, estimator) };
            }
            return { ...block, content: `${notice}${truncatedContent}`.trimEnd() };
        }
        case 'memory':
            return { ...block, content: safeTruncateText(block.content, maxTokens, estimator) };
        case 'profile_summary':
        case 'rolling_summary':
        case 'base_system':
        case 'trunc_notice':
        default:
            return { ...block, content: safeTruncateText(block.content, maxTokens, estimator) };
    }
}

function applyHardMax(
    blocks: ContextBlock[],
    estimator: (text: string) => number,
): { blocks: ContextBlock[]; truncated: boolean } {
    let truncated = false;
    const nextBlocks = blocks.map((block) => {
        if (block.hardMaxTokens === undefined) {
            return block;
        }

        const currentTokens = estimator(block.content);
        if (currentTokens <= block.hardMaxTokens) {
            return block;
        }

        truncated = true;
        return truncateBlockContent(block, block.hardMaxTokens, estimator);
    });

    return { blocks: nextBlocks, truncated };
}

function truncateToFit(
    blocks: ContextBlock[],
    blockId: ContextBlockId,
    targetMaxTokens: number,
    estimator: (text: string) => number,
): ContextBlock[] {
    return blocks.map((block) => {
        if (block.id !== blockId) {
            return block;
        }

        const minTokens = block.minTokens ?? 0;
        const desired = Math.max(minTokens, targetMaxTokens);
        return truncateBlockContent(block, desired, estimator);
    });
}

function dropBlock(blocks: ContextBlock[], blockId: ContextBlockId): ContextBlock[] {
    return blocks.filter((block) => block.id !== blockId);
}

function totalTokens(blocks: ContextBlock[], estimator: (text: string) => number): number {
    return blocks.reduce((sum, block) => sum + estimateBlockTokens(block, estimator), 0);
}

function findBlock(blocks: ContextBlock[], id: ContextBlockId): ContextBlock | undefined {
    return blocks.find((block) => block.id === id);
}

const TRUNCATION_ORDER: ContextBlockId[] = [
    'transcript',
    'rolling_summary',
    'profile_summary',
    'intent_hint',
    'reply_context',
    'memory',
    'user',
];

function insertTruncationNotice(
    blocks: ContextBlock[],
    noticeText: string,
    estimator: (text: string) => number,
    maxAllowedTokens: number,
): ContextBlock[] {
    const noticeBlock: ContextBlock = {
        id: 'trunc_notice',
        role: 'system',
        content: noticeText,
        priority: 95,
        truncatable: false,
    };

    const noticeTokens = estimateBlockTokens(noticeBlock, estimator);
    const currentTotal = totalTokens(blocks, estimator);
    if (currentTotal + noticeTokens > maxAllowedTokens) {
        return blocks;
    }

    const baseIndex = blocks.findIndex((block) => block.id === 'base_system');
    if (baseIndex === -1) {
        return [noticeBlock, ...blocks];
    }

    return [
        ...blocks.slice(0, baseIndex + 1),
        noticeBlock,
        ...blocks.slice(baseIndex + 1),
    ];
}

export function budgetContextBlocks(
    blocks: ContextBlock[],
    opts: ContextBudgetOptions,
): ContextBlock[] {
    const estimator = opts.estimateTokens ?? estimateTokens;
    const maxAllowedTokens = Math.max(0, opts.maxInputTokens - opts.reservedOutputTokens);

    const hardMaxResult = applyHardMax(blocks, estimator);
    let workingBlocks = hardMaxResult.blocks;

    let truncated = hardMaxResult.truncated;
    let total = totalTokens(workingBlocks, estimator);
    if (total <= maxAllowedTokens) {
        if (truncated && opts.truncationNoticeEnabled) {
            return insertTruncationNotice(
                workingBlocks,
                opts.truncationNoticeText ?? DEFAULT_TRUNCATION_NOTICE,
                estimator,
                maxAllowedTokens,
            );
        }
        return workingBlocks;
    }

    for (const blockId of TRUNCATION_ORDER) {
        const block = findBlock(workingBlocks, blockId);
        if (!block) {
            continue;
        }

        if (total <= maxAllowedTokens) {
            break;
        }

        if (!block.truncatable) {
            if (blockId !== 'user') {
                workingBlocks = dropBlock(workingBlocks, blockId);
                truncated = true;
                total = totalTokens(workingBlocks, estimator);
            }
            continue;
        }

        const minTokens = block.minTokens ?? 0;
        const upperBound = estimator(block.content);

        if (upperBound > minTokens) {
            let bestTokens = upperBound;
            let low = minTokens;
            let high = upperBound;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const candidateBlocks = truncateToFit(workingBlocks, blockId, mid, estimator);
                const candidateTotal = totalTokens(candidateBlocks, estimator);

                if (candidateTotal <= maxAllowedTokens) {
                    bestTokens = mid;
                    high = mid - 1;
                } else {
                    low = mid + 1;
                }
            }

            if (bestTokens < upperBound) {
                workingBlocks = truncateToFit(workingBlocks, blockId, bestTokens, estimator);
                truncated = true;
                total = totalTokens(workingBlocks, estimator);
            }
        }

        if (total > maxAllowedTokens && blockId !== 'user') {
            workingBlocks = dropBlock(workingBlocks, blockId);
            truncated = true;
            total = totalTokens(workingBlocks, estimator);
        }
    }

    if (total > maxAllowedTokens) {
        const userBlock = findBlock(workingBlocks, 'user');
        if (userBlock) {
            const userTokens = estimator(userBlock.content);
            if (userTokens > 0) {
                let low = 0;
                let high = userTokens;
                let best = userTokens;

                while (low <= high) {
                    const mid = Math.floor((low + high) / 2);
                    const candidateBlocks = truncateToFit(workingBlocks, 'user', mid, estimator);
                    const candidateTotal = totalTokens(candidateBlocks, estimator);

                    if (candidateTotal <= maxAllowedTokens) {
                        best = mid;
                        high = mid - 1;
                    } else {
                        low = mid + 1;
                    }
                }

                workingBlocks = truncateToFit(workingBlocks, 'user', best, estimator);
                truncated = true;
                total = totalTokens(workingBlocks, estimator);
            }
        }
    }

    if (truncated && total <= maxAllowedTokens && opts.truncationNoticeEnabled) {
        return insertTruncationNotice(
            workingBlocks,
            opts.truncationNoticeText ?? DEFAULT_TRUNCATION_NOTICE,
            estimator,
            maxAllowedTokens,
        );
    }

    return workingBlocks;
}

export const DEFAULT_TRUNCATION_NOTICE =
    'Note: Context was truncated to fit the model window. Some older transcript/summary content may be omitted.';
