import { beforeAll, describe, expect, it } from 'vitest';

import { buildUniversalPromptContract } from '../../../../src/features/agent-runtime/promptContract';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';
import { getPromptToolGuidance, getTopLevelToolDoc } from '../../../../src/features/agent-runtime/toolDocs';

function buildPrompt(activeTools: string[]): string {
  return buildUniversalPromptContract({
    userProfileSummary: null,
    currentTurn: {
      invokerUserId: 'user-1',
      invokerDisplayName: 'User One',
      messageId: 'message-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      invokedBy: 'mention',
      mentionedUserIds: [],
      isDirectReply: false,
      replyTargetMessageId: null,
      replyTargetAuthorId: null,
      botUserId: 'sage-bot',
    },
    userText: 'help',
    activeTools,
    model: 'kimi',
    inGuild: true,
    turnMode: 'text',
  }).systemMessage;
}

beforeAll(async () => {
  await registerDefaultAgenticTools();
});

describe('discord tool mental model guidance', () => {
  it('distinguishes instruction reads from instruction writes', () => {
    const readDoc = getTopLevelToolDoc('discord_context_get_server_instructions');
    const writeDoc = getTopLevelToolDoc('discord_admin_update_server_instructions');

    expect(readDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('read the current guild persona'),
      ]),
    );
    expect(writeDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('change Sage'),
      ]),
    );
    expect(writeDoc?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('read the current instructions'),
      ]),
    );
  });

  it('distinguishes continuity summaries from exact message evidence', () => {
    const summaryDoc = getTopLevelToolDoc('discord_context_get_channel_summary');
    const evidenceDoc = getTopLevelToolDoc('discord_messages_search_history');

    expect(summaryDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('continuity'),
      ]),
    );
    expect(summaryDoc?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exact message-level evidence'),
      ]),
    );
    expect(evidenceDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exact message-history evidence'),
      ]),
    );
    expect(evidenceDoc?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('high-level continuity'),
      ]),
    );
  });

  it('distinguishes governance changes from moderation actions', () => {
    const personaDoc = getTopLevelToolDoc('discord_admin_update_server_instructions');
    const moderationDoc = getTopLevelToolDoc('discord_admin_submit_moderation');

    expect(personaDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('change Sage'),
      ]),
    );
    expect(moderationDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('moderation and enforcement'),
      ]),
    );
    expect(moderationDoc?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('changing Sage behavior'),
      ]),
    );
  });

  it('distinguishes file recall from guild inventory', () => {
    const fileDoc = getTopLevelToolDoc('discord_files_find_channel');
    const serverDoc = getTopLevelToolDoc('discord_server_list_channels');

    expect(fileDoc?.selectionHints.length ?? 0).toBeGreaterThan(0);
    expect(serverDoc?.selectionHints.length ?? 0).toBeGreaterThan(0);
    expect(buildPrompt([
      'discord_files_find_channel',
      'discord_server_list_channels',
    ])).toContain('File recall vs guild resources');
  });

  it('distinguishes voice analytics from live voice control', () => {
    const prompt = buildPrompt([
      'discord_context_get_voice_analytics',
      'discord_voice_join_current_channel',
    ]);

    expect(prompt).toContain('Voice analytics vs live control');
  });

  it('surfaces Discord routing distinctions directly in the prompt', () => {
    const prompt = buildPrompt([
      'discord_context_get_channel_summary',
      'discord_context_get_server_instructions',
      'discord_messages_search_history',
      'discord_files_find_channel',
      'discord_server_list_channels',
      'discord_admin_update_server_instructions',
      'discord_admin_submit_moderation',
      'discord_voice_join_current_channel',
      'discord_context_get_voice_analytics',
    ]);

    expect(prompt).toContain('<tool_protocol>');
    expect(prompt).toContain('Summary vs exact evidence');
    expect(prompt).toContain('Sage Persona read vs write');
    expect(prompt).toContain('Governance/config vs moderation');
    expect(prompt).toContain('Reply-targeted enforcement uses moderation tools');
    expect(prompt).toContain('File recall vs guild resources');
    expect(prompt).toContain('Voice analytics vs live control');
  });

  it('keeps prompt guidance aligned with granular Discord docs', () => {
    const summaryGuidance = getPromptToolGuidance('discord_context_get_channel_summary');
    const moderationDoc = getTopLevelToolDoc('discord_admin_submit_moderation');
    const inviteDoc = getTopLevelToolDoc('discord_admin_get_invite_url');

    expect(summaryGuidance?.purpose ?? '').not.toHaveLength(0);
    expect(moderationDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('moderation and enforcement'),
      ]),
    );
    expect(inviteDoc?.selectionHints.length ?? 0).toBeGreaterThan(0);
  });
});
