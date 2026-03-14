import { describe, expect, it } from 'vitest';

import { buildCapabilityPromptSection } from '../../../../src/features/agent-runtime/capabilityPrompt';
import { getRoutedToolDoc } from '../../../../src/features/agent-runtime/toolDocs';

describe('discord tool mental model guidance', () => {
  it('distinguishes instruction reads from instruction writes', () => {
    const contextDoc = getRoutedToolDoc('discord_context');
    const adminDoc = getRoutedToolDoc('discord_admin');

    expect(contextDoc).not.toBeNull();
    expect(adminDoc).not.toBeNull();

    const readAction = contextDoc?.actions.find((action) => action.action === 'get_server_instructions');
    const writeAction = adminDoc?.actions.find((action) => action.action === 'update_server_instructions');

    expect(readAction?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord_admin.update_server_instructions'),
      ]),
    );
    expect(writeAction?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord_context.get_server_instructions'),
        expect.stringContaining('submit_moderation'),
      ]),
    );
    expect(writeAction?.commonMistakes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('submit_moderation'),
      ]),
    );
  });

  it('distinguishes governance/config from moderation/enforcement', () => {
    const adminDoc = getRoutedToolDoc('discord_admin');

    const updateInstructions = adminDoc?.actions.find((action) => action.action === 'update_server_instructions');
    const moderation = adminDoc?.actions.find((action) => action.action === 'submit_moderation');
    const deleteMessage = adminDoc?.actions.find((action) => action.action === 'delete_message');

    expect(adminDoc?.routingNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Sage Persona/config and moderation as separate admin domains'),
        expect.stringContaining('submit_moderation is for enforcement workflows'),
        expect.stringContaining('Reply-targeted cleanup'),
      ]),
    );
    expect(adminDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Governance/config for Sage or the review surface'),
        expect.stringContaining('reply-targeted "delete this spam/abuse message" requests -> submit_moderation'),
      ]),
    );
    expect(updateInstructions?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('moderation or enforcement'),
      ]),
    );
    expect(moderation?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Sage persona, tone, behavior rules, or server policy posture'),
      ]),
    );
    expect(moderation?.commonMistakes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('update_server_instructions'),
        expect.stringContaining('generic delete_message'),
      ]),
    );
    expect(moderation?.optionalFields).toEqual(
      expect.arrayContaining([
        'request.messageIds',
        'request.limit',
        'request.windowMinutes',
        'request.authorUserId',
      ]),
    );
    expect(moderation?.resultNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bulk_delete_messages'),
        expect.stringContaining('purge_recent_messages'),
        expect.stringContaining('older than 14 days'),
      ]),
    );
    expect(deleteMessage?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('submit_moderation'),
      ]),
    );
    expect(deleteMessage?.commonMistakes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('replied-to spam/abusive user content'),
      ]),
    );
  });

  it('distinguishes rolling summaries from exact message windows', () => {
    const contextDoc = getRoutedToolDoc('discord_context');
    const messagesDoc = getRoutedToolDoc('discord_messages');

    const summaryAction = contextDoc?.actions.find((action) => action.action === 'get_channel_summary');
    const messageWindowAction = messagesDoc?.actions.find((action) => action.action === 'get_context');

    expect(summaryAction?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('message-level evidence'),
      ]),
    );
    expect(messageWindowAction?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord_context.get_channel_summary'),
      ]),
    );
  });

  it('keeps thread lifecycle under discord_server rather than discord_messages', () => {
    const messagesDoc = getRoutedToolDoc('discord_messages');
    const serverDoc = getRoutedToolDoc('discord_server');

    expect(messagesDoc?.routingNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Thread lifecycle belongs to discord_server'),
      ]),
    );
    expect(serverDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Thread lifecycle writes'),
      ]),
    );
  });

  it('marks admin-only reads distinctly from public guild reads', () => {
    const serverDoc = getRoutedToolDoc('discord_server');

    expect(serverDoc?.routingNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('admin-only reads'),
      ]),
    );

    const listMembers = serverDoc?.actions.find((action) => action.action === 'list_members');
    const getMember = serverDoc?.actions.find((action) => action.action === 'get_member');

    expect(listMembers?.restrictions).toEqual(
      expect.arrayContaining([
        'Admin-only read.',
      ]),
    );
    expect(getMember?.restrictions).toEqual(
      expect.arrayContaining([
        'Admin-only read.',
      ]),
    );
  });

  it('distinguishes voice analytics from live voice control', () => {
    const contextDoc = getRoutedToolDoc('discord_context');
    const voiceDoc = getRoutedToolDoc('discord_voice');

    const voiceAnalytics = contextDoc?.actions.find((action) => action.action === 'get_voice_analytics');
    const voiceSummaries = contextDoc?.actions.find((action) => action.action === 'get_voice_summaries');

    expect(voiceAnalytics?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord_voice'),
      ]),
    );
    expect(voiceSummaries?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord_voice'),
      ]),
    );
    expect(voiceDoc?.routingNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord_context'),
      ]),
    );
  });

  it('distinguishes file discovery from channel or server inventory', () => {
    const filesDoc = getRoutedToolDoc('discord_files');

    expect(filesDoc?.routingNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('enumerate files, not channels or guild resources'),
        expect.stringContaining('search attachment text, not message history'),
      ]),
    );

    const listChannel = filesDoc?.actions.find((action) => action.action === 'list_channel');
    const findChannel = filesDoc?.actions.find((action) => action.action === 'find_channel');

    expect(listChannel?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord_server.list_channels'),
      ]),
    );
    expect(findChannel?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('discord_messages.search_history'),
      ]),
    );
  });

  it('teaches api as a fallback rather than a first-choice admin action', () => {
    const adminDoc = getRoutedToolDoc('discord_admin');
    const apiAction = adminDoc?.actions.find((action) => action.action === 'api');

    expect(adminDoc?.routingNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fallback only'),
      ]),
    );
    expect(adminDoc?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Bulk message enforcement'),
      ]),
    );
    expect(apiAction?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bulk/purge moderation'),
      ]),
    );
    expect(apiAction?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('typed action already covers the task'),
      ]),
    );
    expect(apiAction?.commonMistakes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('typed discord_server or discord_admin actions'),
      ]),
    );
  });

  it('teaches send presentation as a payload contract rather than decoration', () => {
    const messagesDoc = getRoutedToolDoc('discord_messages');
    const sendAction = messagesDoc?.actions.find((action) => action.action === 'send');

    expect(messagesDoc?.routingNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('presentation mode'),
      ]),
    );
    expect(sendAction?.restrictions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('components_v2 must not include content'),
      ]),
    );
    expect(sendAction?.commonMistakes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('presentation as a cosmetic toggle'),
      ]),
    );
  });

  it('teaches routed-tool help as the self-discovery path and direct tools as schema-only', () => {
    const prompt = buildCapabilityPromptSection({
      activeTools: ['discord_context', 'discord_messages', 'web', 'system_time'],
    });

    expect(prompt).toContain('<operator_model>');
    expect(prompt).toContain('Routed tools expose action-level `help`');
    expect(prompt).toContain('Direct tools do not expose `help`; rely on schema and description');
    expect(prompt).toContain('Use it only when a routed-tool contract is genuinely unclear.');
  });

  it('surfaces the critical Discord distinctions together in the capability prompt', () => {
    const prompt = buildCapabilityPromptSection({
      activeTools: [
        'discord_context',
        'discord_messages',
        'discord_files',
        'discord_server',
        'discord_admin',
        'discord_voice',
      ],
    });

    expect(prompt).toContain('Sage Persona read vs write');
    expect(prompt).toContain('Governance/config vs moderation');
    expect(prompt).toContain('Reply-targeted enforcement uses moderation');
    expect(prompt).toContain('Summary vs exact evidence: `discord_context.get_channel_summary` is recap');
    expect(prompt).toContain('File recall vs guild resources');
    expect(prompt).toContain('Voice analytics vs live control');
    expect(prompt).toContain('Change Sage behavior or governance config');
    expect(prompt).toContain('Enforce on user or content');
  });
});
