import { LLMChatMessage, LLMContentPart, LLMMessageContent } from '../types';

export type ModelLimits = {
  model: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  safetyMarginTokens: number;
  visionEnabled?: boolean;
};

export type BudgetPlan = {
  limits: ModelLimits;
  reservedOutputTokens: number;
  availableInputTokens: number;
};

export type TrimStats = {
  beforeCount: number;
  afterCount: number;
  droppedCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  model: string;
  notes: string[];
};

export type TokenEstimateOptions = {
  charsPerToken: number;
  codeCharsPerToken: number;
  imageTokens: number;
  messageOverheadTokens: number;
};

export type TrimMessagesOptions = {
  keepSystemMessages?: boolean;
  keepLastUserTurns?: number;
  visionFadeKeepLastUserImages?: number;
  attachmentTextMaxTokens?: number;
  strategy?: 'drop_oldest' | 'summarize_oldest';
  estimator?: TokenEstimateOptions;
  visionEnabled?: boolean;
};

const DEFAULT_TOKEN_ESTIMATOR: TokenEstimateOptions = {
  charsPerToken: 4,
  codeCharsPerToken: 3.5,
  imageTokens: 1200,
  messageOverheadTokens: 4,
};

const REPLY_REFERENCE_PREFIX = '[In reply to]:';

export function planBudget(
  limits: ModelLimits,
  opts?: { reservedOutputTokens?: number },
): BudgetPlan {
  const reservedOutputTokens = Math.max(
    0,
    opts?.reservedOutputTokens ?? limits.maxOutputTokens,
  );
  const availableInputTokens = Math.max(
    0,
    limits.maxContextTokens - reservedOutputTokens - limits.safetyMarginTokens,
  );

  return {
    limits,
    reservedOutputTokens,
    availableInputTokens,
  };
}

function isContentArray(content: LLMMessageContent): content is LLMContentPart[] {
  return Array.isArray(content);
}

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

function applyTextToContent(content: LLMMessageContent, text: string): LLMMessageContent {
  if (typeof content === 'string') {
    return text;
  }

  const nextText = ensureNonEmptyTextForMultimodal(content, text);
  let applied = false;
  return content.map((part) => {
    if (part.type !== 'text') {
      return part;
    }
    if (!applied) {
      applied = true;
      return { ...part, text: nextText };
    }
    return { ...part, text: '' };
  });
}

function cloneMessage(message: LLMChatMessage): LLMChatMessage {
  if (isContentArray(message.content)) {
    return {
      ...message,
      content: message.content.map((part) => ({ ...part })),
    };
  }
  return { ...message };
}

function isLikelyCodeOrJson(text: string): boolean {
  if (text.includes('```')) {
    return true;
  }

  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return true;
  }

  const nonWordMatches = text.match(/[^A-Za-z0-9\s]/g) ?? [];
  const density = text.length > 0 ? nonWordMatches.length / text.length : 0;
  return density >= 0.3;
}

export function estimateTextTokens(text: string, opts?: TokenEstimateOptions): number {
  const estimator = opts ?? DEFAULT_TOKEN_ESTIMATOR;
  const ratio = isLikelyCodeOrJson(text) ? estimator.codeCharsPerToken : estimator.charsPerToken;
  if (ratio <= 0) {
    return text.length;
  }
  return Math.ceil(text.length / ratio);
}

export function estimateMessageTokens(
  message: LLMChatMessage,
  opts?: TokenEstimateOptions,
): number {
  const estimator = opts ?? DEFAULT_TOKEN_ESTIMATOR;
  if (typeof message.content === 'string') {
    return estimateTextTokens(message.content, estimator) + estimator.messageOverheadTokens;
  }

  let total = estimator.messageOverheadTokens;
  for (const part of message.content) {
    if (part.type === 'text') {
      total += estimateTextTokens(part.text, estimator);
    } else if (part.type === 'image_url') {
      total += estimator.imageTokens;
    }
  }
  return total;
}

export function estimateMessagesTokens(
  messages: LLMChatMessage[],
  opts?: TokenEstimateOptions,
): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message, opts), 0);
}

function safeTruncateText(
  text: string,
  maxTokens: number,
  estimator: TokenEstimateOptions,
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
    const tokens = estimateTextTokens(candidate, estimator);
    if (tokens <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best.trimEnd();
}

function truncateMessageTextToTokens(
  message: LLMChatMessage,
  maxTokens: number,
  estimator: TokenEstimateOptions,
): LLMChatMessage {
  if (maxTokens <= 0) {
    return { ...message, content: applyTextToContent(message.content, '') };
  }

  const text = extractText(message.content);
  const imageCount = isContentArray(message.content)
    ? message.content.filter((part) => part.type === 'image_url').length
    : 0;
  const availableTextTokens = Math.max(
    0,
    maxTokens - estimator.messageOverheadTokens - imageCount * estimator.imageTokens,
  );
  const truncated = safeTruncateText(text, availableTextTokens, estimator);
  return { ...message, content: applyTextToContent(message.content, truncated) };
}

function getMultimodalUserIndexes(messages: LLMChatMessage[]): number[] {
  return messages
    .map((m, i) => ({ m, i }))
    .filter(
      ({ m }) =>
        m.role === 'user' &&
        isContentArray(m.content) &&
        m.content.some((part) => part.type === 'image_url'),
    )
    .map(({ i }) => i);
}

function getLastUserIndex(messages: LLMChatMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return i;
  }
  return null;
}

function isReplyReferenceMessage(message: LLMChatMessage): boolean {
  if (message.role !== 'user' || !isContentArray(message.content)) {
    return false;
  }

  return message.content.some(
    (part) => part.type === 'text' && part.text.trimStart().startsWith(REPLY_REFERENCE_PREFIX),
  );
}

function selectVisionKeepIndexes(
  messages: LLMChatMessage[],
  keepCount: number,
): Set<number> {
  const multimodalUserIndexes = getMultimodalUserIndexes(messages);
  if (multimodalUserIndexes.length === 0 || keepCount <= 0) {
    return new Set();
  }

  const lastUserIndex = getLastUserIndex(messages);
  if (lastUserIndex !== null) {
    const lastUserMessage = messages[lastUserIndex];
    if (lastUserMessage.role === 'user' && isContentArray(lastUserMessage.content)) {
      return new Set([lastUserIndex].slice(-keepCount));
    }
  }

  const replyIndexes = multimodalUserIndexes.filter((index) =>
    isReplyReferenceMessage(messages[index]),
  );
  if (replyIndexes.length > 0) {
    return new Set(replyIndexes.slice(-keepCount));
  }

  return new Set();
}

function fadeVisionMessages(
  messages: LLMChatMessage[],
  keepSet: Set<number>,
  notes: string[],
): LLMChatMessage[] {
  let fadedCount = 0;
  const updated = messages.map((msg, index) => {
    if (msg.role === 'user' && isContentArray(msg.content) && !keepSet.has(index)) {
      const textOnly = msg.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim();

      const content = `${textOnly.length ? textOnly : ' '} [Image omitted from history]`;
      fadedCount += 1;
      return { ...msg, content };
    }

    return cloneMessage(msg);
  });

  if (fadedCount > 0) {
    notes.push(`faded ${fadedCount} image message(s) to text-only history`);
  }

  return updated;
}

function stripImagesFromMessages(
  messages: LLMChatMessage[],
  notes: string[],
): LLMChatMessage[] {
  let strippedCount = 0;
  const updated = messages.map((msg) => {
    if (!isContentArray(msg.content)) {
      return cloneMessage(msg);
    }

    const hasImage = msg.content.some((part) => part.type === 'image_url');
    if (!hasImage) {
      return cloneMessage(msg);
    }

    const textOnly = msg.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();
    strippedCount += 1;
    return {
      ...msg,
      content: `${textOnly.length ? textOnly : ' '} [Image omitted: vision disabled]`,
    };
  });

  if (strippedCount > 0) {
    notes.push(`stripped ${strippedCount} image message(s) (vision disabled)`);
  }

  return updated;
}

function truncateAttachmentBlocks(
  text: string,
  maxTokens: number,
  estimator: TokenEstimateOptions,
): { text: string; truncated: boolean } {
  if (!text.includes('--- BEGIN FILE ATTACHMENT:') || maxTokens <= 0) {
    return { text, truncated: false };
  }

  let truncated = false;
  let output = text;
  const blockRegex =
    /--- BEGIN FILE ATTACHMENT: ([^\n]+) ---\n([\s\S]*?)\n--- END FILE ATTACHMENT ---/g;

  output = output.replace(blockRegex, (match, filename, body) => {
    const bodyTokens = estimateTextTokens(body, estimator);
    if (bodyTokens <= maxTokens) {
      return match;
    }

    const truncatedBody = safeTruncateText(body, maxTokens, estimator);
    truncated = true;
    const note = `[System: Attachment '${String(filename).trim()}' truncated to fit context limits.]`;
    return `--- BEGIN FILE ATTACHMENT: ${String(filename).trim()} ---\n${truncatedBody}\n--- END FILE ATTACHMENT ---\n${note}`;
  });

  return { text: output, truncated };
}

function applyAttachmentTruncation(
  messages: LLMChatMessage[],
  maxTokens: number | undefined,
  estimator: TokenEstimateOptions,
  notes: string[],
): LLMChatMessage[] {
  if (!maxTokens || maxTokens <= 0) {
    return messages.map((msg) => cloneMessage(msg));
  }

  let truncatedCount = 0;
  const updated = messages.map((message) => {
    const text = extractText(message.content);
    if (!text.includes('--- BEGIN FILE ATTACHMENT:')) {
      return cloneMessage(message);
    }

    const result = truncateAttachmentBlocks(text, maxTokens, estimator);
    if (result.truncated) {
      truncatedCount += 1;
    }
    return { ...message, content: applyTextToContent(message.content, result.text) };
  });

  if (truncatedCount > 0) {
    notes.push(`truncated ${truncatedCount} attachment block(s)`);
  }

  return updated;
}

function findProtectedStartIndex(messages: LLMChatMessage[], keepLastUserTurns: number): number {
  if (keepLastUserTurns <= 0) {
    return messages.length;
  }

  let remaining = keepLastUserTurns;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      remaining -= 1;
      if (remaining <= 0) {
        return i;
      }
    }
  }

  return 0;
}

function buildProtectedMessageSet(
  messages: LLMChatMessage[],
  keepSystemMessages: boolean,
  keepStartIndex: number,
): Set<LLMChatMessage> {
  const protectedMessages = new Set<LLMChatMessage>();
  messages.forEach((msg, index) => {
    if ((keepSystemMessages && msg.role === 'system') || index >= keepStartIndex) {
      protectedMessages.add(msg);
    }
  });
  return protectedMessages;
}

function trimOldestMessages(
  messages: LLMChatMessage[],
  protectedMessages: Set<LLMChatMessage>,
  estimator: TokenEstimateOptions,
  availableTokens: number,
  notes: string[],
): LLMChatMessage[] {
  const working = messages.slice();
  let dropped = 0;

  while (working.length > 1 && estimateMessagesTokens(working, estimator) > availableTokens) {
    const dropIndex = working.findIndex((msg) => !protectedMessages.has(msg));
    if (dropIndex === -1) {
      break;
    }
    working.splice(dropIndex, 1);
    dropped += 1;
  }

  if (dropped > 0) {
    notes.push(`dropped ${dropped} oldest message(s)`);
  }

  return working;
}

function truncateProtectedMessageToFit(
  messages: LLMChatMessage[],
  estimator: TokenEstimateOptions,
  availableTokens: number,
  notes: string[],
): LLMChatMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  const working = messages.slice();
  const total = estimateMessagesTokens(working, estimator);
  if (total <= availableTokens) {
    return working;
  }

  const targetIndex = working.findIndex((msg) => msg.role !== 'system');
  if (targetIndex === -1) {
    return working;
  }

  const targetMessage = working[targetIndex];
  const targetTokens = estimateMessageTokens(targetMessage, estimator);
  const overflow = total - availableTokens;
  const newMaxTokens = Math.max(0, targetTokens - overflow);

  working[targetIndex] = truncateMessageTextToTokens(targetMessage, newMaxTokens, estimator);
  notes.push('truncated a protected message to fit budget');

  return working;
}

function ensureNonEmptyMessages(messages: LLMChatMessage[]): LLMChatMessage[] {
  if (messages.length > 0) {
    return messages;
  }

  return [{ role: 'user', content: ' ' }];
}

export function trimMessagesToBudget(
  messages: LLMChatMessage[],
  plan: BudgetPlan,
  opts?: TrimMessagesOptions,
): { trimmed: LLMChatMessage[]; stats: TrimStats } {
  const notes: string[] = [];
  const estimator = opts?.estimator ?? DEFAULT_TOKEN_ESTIMATOR;
  const keepSystemMessages = opts?.keepSystemMessages ?? true;
  const keepLastUserTurns = opts?.keepLastUserTurns ?? 4;
  const keepImageCount = opts?.visionFadeKeepLastUserImages ?? 1;
  const visionEnabled = opts?.visionEnabled ?? plan.limits.visionEnabled ?? true;

  if (opts?.strategy === 'summarize_oldest') {
    notes.push('summarize strategy unavailable; dropping oldest messages instead');
  }

  let working = messages.map((msg) => cloneMessage(msg));

  const estimatedTokensBefore = estimateMessagesTokens(working, estimator);

  if (!visionEnabled) {
    working = stripImagesFromMessages(working, notes);
  } else {
    const keepSet = selectVisionKeepIndexes(working, keepImageCount);
    working = fadeVisionMessages(working, keepSet, notes);
  }

  working = applyAttachmentTruncation(
    working,
    opts?.attachmentTextMaxTokens,
    estimator,
    notes,
  );

  const protectedStartIndex = findProtectedStartIndex(working, keepLastUserTurns);
  const protectedMessages = buildProtectedMessageSet(
    working,
    keepSystemMessages,
    protectedStartIndex,
  );

  working = trimOldestMessages(
    working,
    protectedMessages,
    estimator,
    plan.availableInputTokens,
    notes,
  );

  if (estimateMessagesTokens(working, estimator) > plan.availableInputTokens) {
    working = truncateProtectedMessageToFit(
      working,
      estimator,
      plan.availableInputTokens,
      notes,
    );
  }

  if (estimateMessagesTokens(working, estimator) > plan.availableInputTokens) {
    working = stripImagesFromMessages(working, notes);
  }

  if (estimateMessagesTokens(working, estimator) > plan.availableInputTokens) {
    working = truncateProtectedMessageToFit(
      working,
      estimator,
      plan.availableInputTokens,
      notes,
    );
  }

  const trimmed = ensureNonEmptyMessages(working);
  const estimatedTokensAfter = estimateMessagesTokens(trimmed, estimator);
  const droppedCount = Math.max(0, messages.length - trimmed.length);

  return {
    trimmed,
    stats: {
      beforeCount: messages.length,
      afterCount: trimmed.length,
      droppedCount,
      estimatedTokensBefore,
      estimatedTokensAfter,
      model: plan.limits.model,
      notes,
    },
  };
}
