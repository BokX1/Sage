/**
 * Enforce prompt token budgets across ordered context blocks.
 *
 * Responsibilities:
 * - Apply per-block hard caps and global prompt budget limits.
 * - Truncate or drop lower-priority blocks when needed.
 * - Optionally inject a truncation notice when context was reduced.
 */
import { estimateTokens } from './tokenEstimate';
import { LLMMessageContent } from '../../platform/llm/llm-types';

/** Identify supported context block classes used by the runtime builder. */
export type ContextBlockId =
  | 'base_system'
  | 'current_turn'
  | 'runtime_instruction'
  | 'server_instructions'
  | 'voice_context'
  | 'transcript'
  | 'intent_hint'
  | 'reply_context'
  | 'user'
  | 'trunc_notice';

/** Describe a budgetable context block before final message assembly. */
export type ContextBlock = {
  id: ContextBlockId;
  role: 'system' | 'assistant' | 'user';
  content: LLMMessageContent;
  priority: number;
  hardMaxTokens?: number;
  minTokens?: number;
  truncatable: boolean;
};

/** Configure global budgeting and truncation-notice behavior. */
export type ContextBudgetOptions = {
  maxInputTokens: number;
  reservedOutputTokens: number;
  estimateTokens?: (text: string) => number;
  truncationNoticeEnabled?: boolean;
  truncationNoticeText?: string;
};

const MESSAGE_OVERHEAD_TOKENS = 4;

function extractText(content: LLMMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }

  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function ensureNonEmptyTextForMultimodal(
  content: LLMMessageContent,
  text: string,
): string {
  if (typeof content === 'string') {
    return text;
  }

  const hasImage = content.some((part) => part.type === 'image_url');
  if (hasImage && text.trim().length === 0) {
    return ' ';
  }

  return text;
}

function applyTextToContent(
  content: LLMMessageContent,
  nextText: string,
): LLMMessageContent {
  if (typeof content === 'string') {
    return nextText;
  }

  const updatedText = ensureNonEmptyTextForMultimodal(content, nextText);
  let textApplied = false;
  return content.map((part) => {
    if (part.type !== 'text') {
      return part;
    }
    if (!textApplied) {
      textApplied = true;
      return { ...part, text: updatedText };
    }
    return { ...part, text: '' };
  });
}

function estimateBlockTokens(block: ContextBlock, estimator: (text: string) => number): number {
  return estimator(extractText(block.content)) + MESSAGE_OVERHEAD_TOKENS;
}

function safeTruncateText(
  text: string,
  maxTokens: number,
  estimator: (text: string) => number,
): string {
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

function safeTruncateEnd(
  text: string,
  maxTokens: number,
  estimator: (text: string) => number,
): string {
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

function truncateTaggedSectionFromEnd(params: {
  sectionText: string;
  tagName: string;
  maxTokens: number;
  estimator: (text: string) => number;
}): string {
  const { sectionText, tagName, maxTokens, estimator } = params;
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const openIndex = sectionText.indexOf(openTag);
  const closeIndex = sectionText.lastIndexOf(closeTag);

  if (openIndex === -1 || closeIndex === -1 || closeIndex < openIndex) {
    return safeTruncateEnd(sectionText, maxTokens, estimator);
  }

  const prefix = sectionText.slice(0, openIndex + openTag.length);
  const inner = sectionText.slice(openIndex + openTag.length, closeIndex);
  const suffix = sectionText.slice(closeIndex);
  const reservedTokens = estimator(prefix) + estimator(suffix);
  if (reservedTokens >= maxTokens) {
    return safeTruncateEnd(sectionText, maxTokens, estimator);
  }

  const truncatedInner = safeTruncateEnd(inner, maxTokens - reservedTokens, estimator);
  return `${prefix}${truncatedInner}${suffix}`.trimEnd();
}

function truncateCombinedUserContent(
  text: string,
  maxTokens: number,
  estimator: (text: string) => number,
): string {
  const userInputStart = text.indexOf('<user_input>');
  if (userInputStart === -1) {
    return safeTruncateEnd(text, maxTokens, estimator);
  }

  const prefix = text.slice(0, userInputStart).trimEnd();
  const userInputSection = text.slice(userInputStart);
  const userInputTokens = estimator(userInputSection);

  if (prefix.length === 0) {
    return truncateTaggedSectionFromEnd({
      sectionText: userInputSection,
      tagName: 'user_input',
      maxTokens,
      estimator,
    });
  }

  const prefixTokens = estimator(prefix);
  if (prefixTokens >= maxTokens) {
    return truncateTaggedSectionFromEnd({
      sectionText: userInputSection,
      tagName: 'user_input',
      maxTokens,
      estimator,
    });
  }

  const remainingForUserInput = Math.max(0, maxTokens - prefixTokens);
  const truncatedUserInput = truncateTaggedSectionFromEnd({
    sectionText: userInputSection,
    tagName: 'user_input',
    maxTokens: remainingForUserInput,
    estimator,
  });

  const combined = `${prefix}\n\n${truncatedUserInput}`.trimEnd();
  if (estimator(combined) <= maxTokens) {
    return combined;
  }

  if (userInputTokens <= maxTokens) {
    return userInputSection;
  }

  return truncateTaggedSectionFromEnd({
    sectionText: userInputSection,
    tagName: 'user_input',
    maxTokens,
    estimator,
  });
}

function truncateBlockContent(
  block: ContextBlock,
  maxTokens: number,
  estimator: (text: string) => number,
): ContextBlock {
  if (maxTokens <= 0) {
    return { ...block, content: applyTextToContent(block.content, '') };
  }

  const contentText = extractText(block.content);

  switch (block.id) {
    case 'transcript':
      return {
        ...block,
        content: applyTextToContent(
          block.content,
          safeTruncateEnd(contentText, maxTokens, estimator),
        ),
      };
    case 'reply_context':
      return {
        ...block,
        content: applyTextToContent(
          block.content,
          safeTruncateEnd(contentText, maxTokens, estimator),
        ),
      };
    case 'user': {
      const notice = 'User message truncated to fit context. Showing most recent portion:\\n';
      const noticeTokens = estimator(notice);
      const availableTokens = Math.max(0, maxTokens - noticeTokens);
      const truncatedContent = truncateCombinedUserContent(contentText, availableTokens, estimator);
      if (truncatedContent.length === contentText.length) {
        return { ...block, content: applyTextToContent(block.content, truncatedContent) };
      }
      if (noticeTokens >= maxTokens) {
        return {
          ...block,
          content: applyTextToContent(
            block.content,
            truncateCombinedUserContent(contentText, maxTokens, estimator),
          ),
        };
      }
      return {
        ...block,
        content: applyTextToContent(block.content, `${notice}${truncatedContent}`.trimEnd()),
      };
    }
    case 'server_instructions':
    case 'current_turn':
      return {
        ...block,
        content: applyTextToContent(
          block.content,
          safeTruncateText(contentText, maxTokens, estimator),
        ),
      };
    case 'base_system':
    case 'trunc_notice':
    default:
      return {
        ...block,
        content: applyTextToContent(
          block.content,
          safeTruncateText(contentText, maxTokens, estimator),
        ),
      };
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

    const currentTokens = estimator(extractText(block.content));
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
  'voice_context',
  'intent_hint',
  'reply_context',
  'server_instructions',
  'user',
];

function makeRoomForNotice(
  blocks: ContextBlock[],
  noticeTokens: number,
  estimator: (text: string) => number,
  maxAllowedTokens: number,
): ContextBlock[] | null {
  let workingBlocks = blocks;
  let total = totalTokens(workingBlocks, estimator);
  let overflow = total + noticeTokens - maxAllowedTokens;
  if (overflow <= 0) {
    return workingBlocks;
  }

  for (const blockId of TRUNCATION_ORDER) {
    if (overflow <= 0) {
      break;
    }

    const block = findBlock(workingBlocks, blockId);
    if (!block) {
      continue;
    }

    const currentTextTokens = estimator(extractText(block.content));
    const minTokens = block.minTokens ?? 0;

    if (block.truncatable && currentTextTokens > minTokens) {
      const desiredTokens = Math.max(minTokens, currentTextTokens - overflow);
      const truncatedBlocks = truncateToFit(workingBlocks, blockId, desiredTokens, estimator);
      const truncatedTotal = totalTokens(truncatedBlocks, estimator);
      if (truncatedTotal < total) {
        workingBlocks = truncatedBlocks;
        total = truncatedTotal;
        overflow = total + noticeTokens - maxAllowedTokens;
      }
    }

    if (overflow > 0 && blockId !== 'user') {
      const droppedBlocks = dropBlock(workingBlocks, blockId);
      if (droppedBlocks.length < workingBlocks.length) {
        workingBlocks = droppedBlocks;
        total = totalTokens(workingBlocks, estimator);
        overflow = total + noticeTokens - maxAllowedTokens;
      }
    }
  }

  return total + noticeTokens <= maxAllowedTokens ? workingBlocks : null;
}

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
  const fittedBlocks =
    currentTotal + noticeTokens <= maxAllowedTokens
      ? blocks
      : makeRoomForNotice(blocks, noticeTokens, estimator, maxAllowedTokens);
  if (!fittedBlocks) {
    return blocks;
  }

  const baseIndex = fittedBlocks.findIndex((block) => block.id === 'base_system');
  if (baseIndex === -1) {
    return [noticeBlock, ...fittedBlocks];
  }

  return [
    ...fittedBlocks.slice(0, baseIndex + 1),
    noticeBlock,
    ...fittedBlocks.slice(baseIndex + 1),
  ];
}

/**
 * Fit context blocks inside the model input budget.
 *
 * @param blocks - Candidate context blocks in priority order.
 * @param opts - Max-input and output-reservation limits.
 * @returns Transformed blocks guaranteed to fit configured budget when possible.
 *
 * Side effects:
 * - None.
 *
 * Error behavior:
 * - Never throws for valid `blocks` and estimator inputs.
 *
 * Invariants:
 * - Returned blocks preserve relative ordering of surviving entries.
 */
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
    const upperBound = estimator(extractText(block.content));

    if (upperBound > minTokens) {
      let bestTokens = minTokens;
      let low = minTokens;
      let high = upperBound;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidateBlocks = truncateToFit(workingBlocks, blockId, mid, estimator);
        const candidateTotal = totalTokens(candidateBlocks, estimator);

        if (candidateTotal <= maxAllowedTokens) {
          bestTokens = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
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
      const userTokens = estimator(extractText(userBlock.content));
      if (userTokens > 0) {
        let low = 0;
        let high = userTokens;
        let best = 0;

        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const candidateBlocks = truncateToFit(workingBlocks, 'user', mid, estimator);
          const candidateTotal = totalTokens(candidateBlocks, estimator);

          if (candidateTotal <= maxAllowedTokens) {
            best = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
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

/** Provide default notice injected when prompt content was truncated. */
export const DEFAULT_TRUNCATION_NOTICE =
  'Note: Context was truncated to fit the model window. Some older transcript or context content may be omitted.';
