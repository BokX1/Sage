import { LLMChatMessage } from '../llm/types';
import { composeSystemPrompt } from './promptComposer';
import { config } from '../config/env';
import { budgetContextBlocks, ContextBlock } from './contextBudgeter';
import { StyleProfile } from './styleClassifier';

export interface BuildContextMessagesParams {
  /** User profile summary for personalization (may be null) */
  userProfileSummary: string | null;
  /** Channel rolling summary (may be null) */
  channelRollingSummary?: string | null;
  /** Channel profile summary (may be null) */
  channelProfileSummary?: string | null;
  /** Previous bot message the user is replying to (may be null) */
  replyToBotText: string | null;
  /** The user's current message text */
  userText: string;
  /** Recent channel transcript block */
  recentTranscript?: string | null;
  /** Optional intent hint for the request */
  intentHint?: string | null;
  /** Relationship hints between users (D7) */
  relationshipHints?: string | null;
  /** Detected style profile (D8) */
  style?: StyleProfile;
  /** Expert packets from MoE orchestration (D9) */
  expertPackets?: string | null;

  // ================================================================
  // TODO (D2/D4): Future context expansion points
  // ----------------------------------------------------------------
  // recentTranscript?: LLMChatMessage[];  // D2: recent channel messages
  // channelSummary?: string;               // D4: channel context summary
  // ================================================================
}

/**
 * Build the context messages array for an LLM chat turn.
 * Output ordering matches current chatEngine behavior
 */
export function buildContextMessages(params: BuildContextMessagesParams): LLMChatMessage[] {
  const {
    userProfileSummary,
    channelRollingSummary,
    channelProfileSummary,
    replyToBotText,
    userText,
    recentTranscript,
    intentHint,
    relationshipHints,
    style,
    expertPackets,
  } = params;

  const blocks: ContextBlock[] = [
    {
      id: 'base_system',
      role: 'system',
      content: composeSystemPrompt({ style }),
      priority: 100,
      truncatable: false,
    },
  ];

  if (channelProfileSummary) {
    blocks.push({
      id: 'profile_summary',
      role: 'system',
      content: channelProfileSummary,
      priority: 70,
      hardMaxTokens: config.contextBlockMaxTokensProfileSummary,
      truncatable: true,
    });
  }

  if (channelRollingSummary) {
    blocks.push({
      id: 'rolling_summary',
      role: 'system',
      content: channelRollingSummary,
      priority: 60,
      hardMaxTokens: config.contextBlockMaxTokensRollingSummary,
      truncatable: true,
    });
  }

  if (relationshipHints) {
    blocks.push({
      id: 'relationship_hints',
      role: 'system',
      content: relationshipHints,
      priority: 65, // Between profile_summary (70) and rolling_summary (60)
      hardMaxTokens: config.contextBlockMaxTokensRelationshipHints,
      truncatable: true,
    });
  }

  if (expertPackets) {
    blocks.push({
      id: 'expert_packets',
      role: 'system',
      content: expertPackets,
      priority: 55, // Between rolling_summary (60) and transcript (50)
      hardMaxTokens: config.contextBlockMaxTokensExperts,
      truncatable: true,
    });
  }

  if (recentTranscript) {
    blocks.push({
      id: 'transcript',
      role: 'system',
      content: recentTranscript,
      priority: 50,
      hardMaxTokens: config.contextBlockMaxTokensTranscript,
      truncatable: true,
    });
  }

  // MOVED: Memory block placed HERE for high Recency Bias (after transcript)
  if (userProfileSummary) {
    blocks.push({
      id: 'memory',
      role: 'system',
      content: `## User Personalization (CRITICAL)
Use these known facts about the user to answer their question:
${userProfileSummary}`,
      priority: 90,
      hardMaxTokens: config.contextBlockMaxTokensMemory,
      truncatable: true,
    });
  }

  if (intentHint) {
    blocks.push({
      id: 'intent_hint',
      role: 'system',
      content: `Intent hint: ${intentHint}`,
      priority: 45,
      hardMaxTokens: config.contextBlockMaxTokensReplyContext,
      truncatable: true,
    });
  }

  if (replyToBotText) {
    blocks.push({
      id: 'reply_context',
      role: 'assistant',
      content: replyToBotText,
      priority: 40,
      hardMaxTokens: config.contextBlockMaxTokensReplyContext,
      truncatable: true,
    });
  }

  blocks.push({
    id: 'user',
    role: 'user',
    content: userText,
    priority: 110,
    hardMaxTokens: config.contextUserMaxTokens,
    truncatable: true,
  });

  const budgetedBlocks = budgetContextBlocks(blocks, {
    maxInputTokens: config.contextMaxInputTokens,
    reservedOutputTokens: config.contextReservedOutputTokens,
    truncationNoticeEnabled: config.contextTruncationNotice,
  });

  // COALESCE SYSTEM MESSAGES
  // Some providers (Pollinations/OpenAI-proxies) drop secondary system messages.
  // We merge them all into a single system message to ensure context delivery.
  const systemContentParts: string[] = [];
  const nonSystemMessages: LLMChatMessage[] = [];

  for (const block of budgetedBlocks) {
    if (block.role === 'system') {
      systemContentParts.push(block.content);
    } else {
      nonSystemMessages.push({ role: block.role, content: block.content });
    }
  }

  const mergedSystemMessage: LLMChatMessage = {
    role: 'system',
    content: systemContentParts.join('\n\n'),
  };

  return [mergedSystemMessage, ...nonSystemMessages];
}
