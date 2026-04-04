import { describe, expect, it } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { CurrentTurnContext } from '../../../../src/features/agent-runtime/continuityContext';
import {
  UNIVERSAL_PROMPT_CONTRACT_VERSION,
  buildPromptContextMessages,
  buildUniversalPromptContract,
  resolveDefaultInvocationUserText,
} from '../../../../src/features/agent-runtime/promptContract';

function makeCurrentTurn(
  overrides: Partial<CurrentTurnContext> & { channelId?: string } = {},
): CurrentTurnContext {
  const responseChannelId = overrides.responseChannelId ?? overrides.channelId ?? 'channel-1';
  const originChannelId = overrides.originChannelId ?? overrides.channelId ?? responseChannelId;
  return {
    invokerUserId: 'user-1',
    invokerDisplayName: 'User One',
    messageId: 'msg-1',
    guildId: 'guild-1',
    originChannelId,
    responseChannelId,
    invokedBy: 'mention',
    mentionedUserIds: [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: 'sage-bot',
    ...overrides,
  };
}

function buildContract(
  overrides: Partial<Parameters<typeof buildUniversalPromptContract>[0]> = {},
) {
  return buildUniversalPromptContract({
    userProfileSummary: 'Prefers concise replies.',
    currentTurn: makeCurrentTurn(),
    activeTools: ['runtime_execute_code'],
    model: 'kimi',
    invokedBy: 'mention',
    invokerAuthority: 'member',
    invokerIsAdmin: false,
    invokerCanModerate: false,
    inGuild: true,
    userText: 'What happened in this channel today?',
    focusedContinuity: 'Focused continuity block',
    recentTranscript: 'Recent transcript block',
    guildSagePersona: 'Keep answers crisp and helpful in this guild.',
    toolObservationEvidence: [
      {
        ref: 'history.search#1',
        toolName: 'history.search',
        status: 'success',
        summary: 'Found matching messages in the channel history.',
      },
    ],
    ...overrides,
  });
}

function renderMessageContent(content: HumanMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if ('text' in part && typeof part.text === 'string') {
        return part.text;
      }
      if ('type' in part && part.type === 'image_url') {
        return '[image]';
      }
      return '';
    })
    .join('');
}

describe('promptContract', () => {
  it('renders a lean markdown system contract with no legacy XML sections', () => {
    const contract = buildContract();

    expect(contract.version).toBe(UNIVERSAL_PROMPT_CONTRACT_VERSION);
    expect(contract.systemMessage).toContain('# Sage Runtime');
    expect(contract.systemMessage).toContain('## Execution model');
    expect(contract.systemMessage).toContain('## Namespace ownership');
    expect(contract.systemMessage).toContain('## Trusted Context Frame');
    expect(contract.systemMessage).not.toContain('<system_contract>');
    expect(contract.systemMessage).not.toContain('<instruction_hierarchy>');
    expect(contract.systemMessage).not.toContain('<assistant_mission>');
    expect(contract.systemMessage).not.toContain('<tool_protocol>');
    expect(contract.systemMessage).not.toContain('<few_shot_examples>');
  });

  it('keeps capability teaching aligned to the bridge-native runtime', () => {
    const prompt = buildContract().systemMessage;

    expect(prompt).toContain('emit at most one `runtime_execute_code` call');
    expect(prompt).toContain('- discord: Live Discord actions only.');
    expect(prompt).toContain('- history: Stored transcript retrieval and search only.');
    expect(prompt).toContain('call `admin.runtime.getCapabilities()` from Code Mode');
    expect(prompt).toContain('Do not infer hidden capabilities');
    expect(prompt).not.toContain('sage.*');
  });

  it('builds two trusted system messages plus one untrusted envelope message', () => {
    const result = buildPromptContextMessages({
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        invokedBy: 'reply',
        isDirectReply: true,
        replyTargetMessageId: 'reply-msg-1',
        replyTargetAuthorId: 'user-2',
      }),
      activeTools: ['runtime_execute_code'],
      model: 'kimi',
      userText: 'Please answer this follow-up',
      userContent: [
        { type: 'text', text: 'Please answer this follow-up' },
        { type: 'image_url', image_url: { url: 'https://example.com/current.png' } },
      ],
      replyTarget: {
        messageId: 'reply-msg-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'user-2',
        authorDisplayName: 'Reference User',
        authorIsBot: false,
        replyToMessageId: null,
        mentionedUserIds: [],
        content: 'Earlier reply',
      },
      focusedContinuity: 'Focused continuity',
      recentTranscript: 'Recent transcript',
    });

    expect(result.messages[0]).toBeInstanceOf(SystemMessage);
    expect(result.messages[1]).toBeInstanceOf(SystemMessage);
    expect(result.messages[2]).toBeInstanceOf(HumanMessage);
    expect(result.trustedContextMessage).toContain('"capabilitySnapshot"');
    expect(result.trustedContextMessage).toContain('"currentTurn"');

    const envelope = renderMessageContent(result.messages[2]!.content);
    expect(envelope).toContain('## Untrusted Context');
    expect(envelope).toContain('### Reply target content (untrusted)');
    expect(envelope).toContain('### Latest user input (untrusted)');
    expect(envelope).toContain('Please answer this follow-up');
    expect(envelope).toContain('[image]');
  });

  it('filters the capability snapshot to the actor authority instead of surfacing the hidden inventory', () => {
    const memberResult = buildPromptContextMessages({
      userProfileSummary: null,
      currentTurn: makeCurrentTurn(),
      activeTools: ['runtime_execute_code'],
      model: 'kimi',
      userText: 'hello',
      invokerAuthority: 'member',
    });

    expect(memberResult.trustedContextMessage).toContain('runtime.getCapabilities');
    expect(memberResult.trustedContextMessage).not.toContain('instructions.update');
    expect(memberResult.trustedContextMessage).not.toContain('roles.add');
  });

  it('captures waiting follow-up state inside the trusted frame instead of a prose-heavy variant prompt', () => {
    const contract = buildPromptContextMessages({
      userProfileSummary: null,
      currentTurn: makeCurrentTurn(),
      activeTools: ['runtime_execute_code'],
      model: 'kimi',
      userText: 'yes',
      promptMode: 'waiting_follow_up',
      waitingFollowUp: {
        matched: true,
        matchKind: 'direct_reply',
        outstandingPrompt: 'Do you want me to dig into the repositories next?',
        responseMessageId: 'response-1',
      },
    });

    expect(contract.trustedContextMessage).toContain('"inputMode":"waiting_follow_up"');
    expect(contract.trustedContextMessage).toContain('"outstandingPrompt":"Do you want me to dig into the repositories next?"');
  });

  it('keeps the prompt fingerprint stable across runtime data and turn-shape changes', () => {
    const first = buildUniversalPromptContract({
      userProfileSummary: 'First user profile',
      currentTurn: makeCurrentTurn({ messageId: 'msg-1', channelId: 'channel-1' }),
      activeTools: ['runtime_execute_code'],
      model: 'kimi',
      userText: 'first user question',
      recentTranscript: 'first transcript window',
    });
    const second = buildUniversalPromptContract({
      userProfileSummary: 'Different user profile',
      currentTurn: makeCurrentTurn({ messageId: 'msg-2', channelId: 'channel-9' }),
      activeTools: ['runtime_execute_code', 'ignored-extra-tool'],
      model: 'glm',
      userText: 'second user question',
      recentTranscript: 'second transcript window',
      guildSagePersona: 'Different tone',
      waitingFollowUp: {
        matched: true,
        matchKind: 'direct_reply',
        outstandingPrompt: 'continue?',
      },
    });

    expect(first.promptFingerprint).toBe(second.promptFingerprint);
  });

  it('centralizes empty-invocation fallback text through prompt adapters', () => {
    expect(
      resolveDefaultInvocationUserText({
        invocationKind: 'reply',
        hasImageContext: false,
        hasReplyTarget: true,
      }),
    ).toEqual(
      expect.objectContaining({
        promptMode: 'reply_only',
      }),
    );

    expect(
      resolveDefaultInvocationUserText({
        invocationKind: 'mention',
        hasImageContext: true,
        hasReplyTarget: false,
      }),
    ).toEqual(
      expect.objectContaining({
        promptMode: 'image_only',
      }),
    );
  });

  it('stays within a lean prompt budget for a full admin turn', () => {
    const contract = buildUniversalPromptContract({
      userProfileSummary: 'Prefers concise replies.',
      currentTurn: makeCurrentTurn(),
      activeTools: ['runtime_execute_code'],
      model: 'kimi',
      invokedBy: 'mention',
      invokerAuthority: 'admin',
      invokerIsAdmin: true,
      invokerCanModerate: true,
      inGuild: true,
      userText: 'Handle this request safely and precisely.',
      recentTranscript: 'Transcript',
      focusedContinuity: 'Focused continuity',
      guildSagePersona: 'Stay crisp.',
      toolObservationEvidence: [
        {
          ref: 'history.search#1',
          toolName: 'history.search',
          status: 'success',
          summary: 'Found matching history results.',
        },
      ],
    });

    expect(contract.systemMessage.length).toBeLessThan(12_000);
  });
});
