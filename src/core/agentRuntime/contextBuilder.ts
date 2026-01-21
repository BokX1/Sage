import { LLMChatMessage } from '../llm/types';
import { composeSystemPrompt } from './promptComposer';
import { config } from '../config/env';
import { budgetContextBlocks, ContextBlock } from './contextBudgeter';
import { StyleProfile } from './styleClassifier';

/**
 * Define inputs for building contextual LLM messages.
 *
 * Details: optional summaries and hints are injected into the system context
 * and trimmed by the context budgeter when needed.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface BuildContextMessagesParams {
  userProfileSummary: string | null;
  channelRollingSummary?: string | null;
  channelProfileSummary?: string | null;
  replyToBotText: string | null;
  userText: string;
  recentTranscript?: string | null;
  intentHint?: string | null;
  relationshipHints?: string | null;
  style?: StyleProfile;
  expertPackets?: string | null;
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
}

/**
 * Build the context messages for an LLM chat turn.
 *
 * Details: assembles system context blocks, applies budget constraints, and
 * coalesces system content to avoid provider drops.
 *
 * Side effects: none.
 * Error behavior: none.
 *
 * @param params - Contextual inputs for the message set.
 * @returns Ordered messages ready for LLM chat calls.
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
    invokedBy,
  } = params;

  let autopilotInstruction = '';
  if (invokedBy === 'autopilot') {
    if (config.autopilotMode === 'reserved') {
      autopilotInstruction = `
## AUTOPILOT MODE: RESERVED
You are currently in RESERVED Autopilot Mode.
STRICTLY remain silent and output [SILENCE] unless:
1. The user explicitly asks for help (even without mentioning you).
2. You have been previously instructed to help a specific user.
3. You can provide a critical fact check or correction.
4. The conversation is stuck and needs a nudge.

Do NOT answer general chatter or greetings in this mode.
Output '[SILENCE]' (without quotes) to remain silent.`;
    } else if (config.autopilotMode === 'talkative') {
      autopilotInstruction = `
## AUTOPILOT MODE: TALKATIVE
You are currently in TALKATIVE Autopilot Mode.
Feel free to join the conversation if you have something interesting, funny, or helpful to add.
If you have nothing to add, output '[SILENCE]' (without quotes).`;
    }
  }

  const baseSystemContent = composeSystemPrompt({
    userProfileSummary,
    style
  }) + autopilotInstruction;

  const blocks: ContextBlock[] = [
    {
      id: 'base_system',
      role: 'system',
      content: baseSystemContent,
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

  // Some providers drop secondary system messages, so merge them into one block.
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
