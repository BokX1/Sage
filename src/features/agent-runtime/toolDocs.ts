export interface RoutedToolActionDoc {
  action: string;
  purpose: string;
  useWhen: string[];
  avoidWhen?: string[];
  requiredFields?: string[];
  optionalFields?: string[];
  defaults?: string[];
  restrictions?: string[];
  resultNotes?: string[];
  examples?: Record<string, unknown>[];
  commonMistakes?: string[];
}

export interface RoutedToolDoc {
  tool: string;
  purpose: string;
  useWhen: string[];
  avoidWhen?: string[];
  routingNotes?: string[];
  selectionHints?: string[];
  actions: RoutedToolActionDoc[];
}

const routedToolDocs = new Map<string, RoutedToolDoc>();

function registerRoutedToolDoc(doc: RoutedToolDoc): RoutedToolDoc {
  routedToolDocs.set(doc.tool, doc);
  return doc;
}

function normalizeActionDoc(
  action: RoutedToolActionDoc,
  includeExamples: boolean,
): Record<string, unknown> {
  return {
    action: action.action,
    purpose: action.purpose,
    use_when: [...action.useWhen],
    avoid_when: action.avoidWhen ? [...action.avoidWhen] : [],
    required_fields: action.requiredFields ? [...action.requiredFields] : [],
    optional_fields: action.optionalFields ? [...action.optionalFields] : [],
    defaults: action.defaults ? [...action.defaults] : [],
    restrictions: action.restrictions ? [...action.restrictions] : [],
    result_notes: action.resultNotes ? [...action.resultNotes] : [],
    examples: includeExamples ? [...(action.examples ?? [])] : [],
    common_mistakes: action.commonMistakes ? [...action.commonMistakes] : [],
  };
}

export function getRoutedToolDoc(toolName: string): RoutedToolDoc | null {
  return routedToolDocs.get(toolName) ?? null;
}

export function isRoutedTool(toolName: string): boolean {
  return routedToolDocs.has(toolName);
}

export function listRoutedToolNames(): string[] {
  return [...routedToolDocs.keys()];
}

export function getRoutedToolSelectionHints(toolName: string): string[] {
  const doc = getRoutedToolDoc(toolName);
  return doc?.selectionHints ? [...doc.selectionHints] : [];
}

export function buildRoutedToolHelp(
  toolName: string,
  options?: { includeExamples?: boolean },
): Record<string, unknown> {
  const doc = getRoutedToolDoc(toolName);
  if (!doc) {
    throw new Error(`No routed tool documentation registered for "${toolName}".`);
  }

  return {
    tool: doc.tool,
    type: 'routed_tool_help',
    purpose: doc.purpose,
    use_when: [...doc.useWhen],
    avoid_when: doc.avoidWhen ? [...doc.avoidWhen] : [],
    routing_notes: doc.routingNotes ? [...doc.routingNotes] : [],
    action_names: doc.actions.map((action) => action.action),
    action_contracts: doc.actions.map((action) =>
      normalizeActionDoc(action, options?.includeExamples !== false),
    ),
  };
}

export const discordContextToolDoc = registerRoutedToolDoc({
  tool: 'discord_context',
  purpose:
    'Read Discord-native context surfaces for the current guild: user profiles, channel summaries, server instructions reads, and social/voice analytics.',
  useWhen: [
    'You need server-internal context rather than public web information.',
    'You need summaries, profiles, or analytics instead of exact message-level evidence.',
    'You need the current guild server instructions as a behavior/persona reference.',
  ],
  avoidWhen: [
    'The user needs exact message quotes or historical proof; use discord_messages instead.',
    'The user needs attachment discovery or recall; use discord_files instead.',
    'The task changes Discord state; use discord_messages or discord_admin instead.',
  ],
  routingNotes: [
    'This tool is read-only.',
    'get_channel_summary is current-channel only.',
    'get_server_instructions requires guild context.',
    'get_top_relationships is read-only but disabled in autopilot turns.',
  ],
  selectionHints: [
    'IF the question is about Discord-internal profiles, summaries, instruction reads, or analytics -> discord_context.',
    '  - Rolling summary of what has been happening -> get_channel_summary.',
    '  - User identity/profile in the server -> get_user_profile.',
    '  - Guild behavior/persona instructions read -> get_server_instructions.',
    '  - Social/voice analytics -> get_social_graph / get_top_relationships / get_voice_analytics / get_voice_summaries.',
    '  - If unsure which context action fits, call discord_context: help.',
  ],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for discord_context.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'get_user_profile',
      purpose: 'Fetch a best-effort long-term personalization profile for a user.',
      useWhen: ['The user asks about someone’s preferences, background, or personal context inside Sage memory.'],
      requiredFields: ['action'],
      optionalFields: ['userId', 'maxChars', 'maxItemsPerSection'],
      defaults: ['userId defaults to the current user.'],
      resultNotes: ['Returns a best-effort profile summary, not verified factual truth.'],
      examples: [{ action: 'get_user_profile', userId: '1234567890', maxChars: 1200 }],
    },
    {
      action: 'get_channel_summary',
      purpose: 'Read rolling and long-term summary context for the current channel.',
      useWhen: ['The user needs situational awareness for what has been happening in the current channel.'],
      avoidWhen: ['The user asks for exact quotes or message-level evidence.'],
      requiredFields: ['action'],
      optionalFields: ['maxChars', 'maxItemsPerList', 'maxRecentFiles'],
      defaults: ['Operates on the current channel only.'],
      resultNotes: ['Summaries are continuity context, not exact history.'],
      examples: [{ action: 'get_channel_summary', maxChars: 1600 }],
    },
    {
      action: 'search_channel_summary_archives',
      purpose: 'Search archived channel summaries for older long-term context.',
      useWhen: ['The request is about older channel themes or summary history rather than exact messages.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['topK', 'maxChars'],
      defaults: ['Operates on the current channel only.'],
      examples: [{ action: 'search_channel_summary_archives', query: 'release planning decisions', topK: 5 }],
    },
    {
      action: 'get_server_instructions',
      purpose: 'Read the current admin-authored server instructions for this guild.',
      useWhen: ['You need the guild-configured behavior/persona rules for Sage.'],
      requiredFields: ['action'],
      optionalFields: ['maxChars'],
      restrictions: ['Requires guild context.'],
      resultNotes: ['This is behavior/persona configuration, not factual truth.'],
      examples: [{ action: 'get_server_instructions', maxChars: 1500 }],
    },
    {
      action: 'get_social_graph',
      purpose: 'Retrieve social-graph relationships for a user.',
      useWhen: ['The user asks who interacts with whom or wants relationship context.'],
      requiredFields: ['action'],
      optionalFields: ['userId', 'maxEdges', 'maxChars'],
      defaults: ['userId defaults to the current user.'],
      examples: [{ action: 'get_social_graph', userId: '1234567890', maxEdges: 10 }],
    },
    {
      action: 'get_top_relationships',
      purpose: 'Show the strongest interaction pairs in the server.',
      useWhen: ['The user wants top interaction relationships server-wide.'],
      requiredFields: ['action'],
      optionalFields: ['limit', 'maxChars'],
      restrictions: ['Disabled in autopilot turns.'],
      examples: [{ action: 'get_top_relationships', limit: 10 }],
    },
    {
      action: 'get_voice_analytics',
      purpose: 'Retrieve voice participation analytics for a user.',
      useWhen: ['The user asks about voice usage or participation.'],
      requiredFields: ['action'],
      optionalFields: ['userId', 'maxChars'],
      defaults: ['userId defaults to the current user.'],
      examples: [{ action: 'get_voice_analytics', userId: '1234567890' }],
    },
    {
      action: 'get_voice_summaries',
      purpose: 'Retrieve recent voice session summaries.',
      useWhen: ['The user wants recent voice-session recap information.'],
      requiredFields: ['action'],
      optionalFields: ['voiceChannelId', 'sinceHours', 'limit', 'maxChars'],
      examples: [{ action: 'get_voice_summaries', sinceHours: 24, limit: 3 }],
    },
  ],
});

export const discordMessagesToolDoc = registerRoutedToolDoc({
  tool: 'discord_messages',
  purpose:
    'Read and write Discord message surfaces: message search/history, context windows, final in-channel replies, reactions, polls, and interactive Components V2 replies.',
  useWhen: [
    'The user needs exact message evidence or message-level actions.',
    'You want the final answer delivered directly into Discord.',
    'You need reactions or polls.',
  ],
  avoidWhen: [
    'You only need summaries or profiles; use discord_context.',
    'You only need attachment discovery or cached file recall; use discord_files.',
    'You need guild-resource inspection or thread lifecycle; use discord_server.',
    'You need admin-only moderation or admin writes; use discord_admin.',
  ],
  routingNotes: [
    'Use search_history or search_with_context for exact evidence.',
    'Use send for final Discord-native delivery.',
    'Thread lifecycle belongs to discord_server.',
    'search_guild and get_user_timeline are disabled in autopilot turns.',
  ],
  selectionHints: [
    'IF the question needs exact Discord message evidence or Discord-native delivery -> discord_messages.',
    '  - Exact quotes or what someone said -> search_history / search_with_context, not get_channel_summary.',
    '  - Known message ID + surrounding window -> get_context.',
    '  - Server-wide historical search -> search_guild.',
    '  - Recent activity for one user -> get_user_timeline.',
    '  - Final Discord-native delivery in the channel -> send with plain / components_v2 presentation.',
    '  - Interactive follow-up buttons or modal-backed flows -> send with components_v2 action_row buttons.',
    '  - Polls and reactions -> create_poll / add_reaction / remove_self_reaction.',
    '  - Thread lifecycle -> discord_server.',
    '  - If unsure which message action fits, call discord_messages: help.',
  ],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for discord_messages.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'search_history',
      purpose: 'Search channel message history via hybrid, semantic, lexical, or regex modes.',
      useWhen: ['The user asks what someone said or needs exact historical evidence.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['channelId', 'topK', 'maxChars', 'mode', 'regexPattern', 'sinceIso', 'untilIso', 'sinceHours', 'sinceDays'],
      defaults: ['channelId defaults to the current channel.', 'mode defaults to the runtime search default.'],
      restrictions: ['In autopilot, cross-channel search is disabled. Use the current channel only.', 'Provide at most one of sinceIso, sinceHours, or sinceDays.'],
      resultNotes: ['Returns permission-filtered message hits with message identifiers suitable for Discord links.'],
      examples: [{ action: 'search_history', query: 'launch blocker', topK: 5, sinceDays: 14 }],
      commonMistakes: ['Do not use get_channel_summary when exact quotes are required.', 'Do not send both sinceIso and sinceDays/sinceHours.'],
    },
    {
      action: 'search_with_context',
      purpose: 'Search history and automatically expand context around the best match.',
      useWhen: ['The user needs both the best match and the surrounding conversation.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['channelId', 'topK', 'maxChars', 'mode', 'regexPattern', 'sinceIso', 'untilIso', 'sinceHours', 'sinceDays', 'before', 'after', 'contextMaxChars'],
      defaults: ['channelId defaults to the current channel.', 'before/after default to 5 when a match is found.'],
      restrictions: ['In autopilot, cross-channel search is disabled.', 'Provide at most one of sinceIso, sinceHours, or sinceDays.'],
      examples: [{ action: 'search_with_context', query: 'error budget', before: 3, after: 3 }],
    },
    {
      action: 'get_context',
      purpose: 'Fetch messages before and after a specific message ID.',
      useWhen: ['You already know the message ID and need the local window around it.'],
      requiredFields: ['action', 'messageId'],
      optionalFields: ['channelId', 'before', 'after', 'maxChars'],
      defaults: ['channelId defaults to the current channel.'],
      restrictions: ['In autopilot, cross-channel lookup is disabled.'],
      examples: [{ action: 'get_context', messageId: '987654321', before: 2, after: 4 }],
    },
    {
      action: 'search_guild',
      purpose: 'Search message history across the entire guild.',
      useWhen: ['The user needs server-wide search instead of a single-channel search.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['topK', 'maxChars', 'mode', 'regexPattern', 'sinceIso', 'untilIso', 'sinceHours', 'sinceDays'],
      restrictions: ['Disabled in autopilot turns.', 'Provide at most one of sinceIso, sinceHours, or sinceDays.'],
      examples: [{ action: 'search_guild', query: 'migration plan', topK: 8 }],
    },
    {
      action: 'get_user_timeline',
      purpose: 'Show recent messages from a user across the guild.',
      useWhen: ['The user asks for a person’s recent server activity.'],
      requiredFields: ['action'],
      optionalFields: ['userId', 'limit', 'maxChars', 'sinceIso', 'untilIso', 'sinceHours', 'sinceDays'],
      defaults: ['userId defaults to the current user.'],
      restrictions: ['Disabled in autopilot turns.', 'Provide at most one of sinceIso, sinceHours, or sinceDays.'],
      examples: [{ action: 'get_user_timeline', userId: '1234567890', limit: 10, sinceDays: 7 }],
    },
    {
      action: 'send',
      purpose: 'Send a new channel message using plain text or Components V2.',
      useWhen: ['The final answer should be delivered directly into Discord.', 'The response benefits from files, layout blocks, buttons, or rich structure.'],
      requiredFields: ['action'],
      optionalFields: ['channelId', 'presentation', 'content', 'files', 'componentsV2', 'reason'],
      defaults: ['channelId defaults to the current channel.', 'presentation defaults to plain.'],
      restrictions: ['Disabled in autopilot turns.', 'Requires guild context.', 'components_v2 must not include content.', 'components_v2 requires componentsV2 and matching attachment names for file/media references.'],
      resultNotes: ['If this action sends the final answer, do not repeat the same answer again in plain assistant prose.'],
      examples: [
        { action: 'send', content: 'Status: all checks passed.' },
        {
          action: 'send',
          presentation: 'components_v2',
          files: [{ filename: 'report.txt', source: { type: 'text', text: 'report body' } }],
          componentsV2: {
            blocks: [
              { type: 'text', content: '**Release summary**' },
              { type: 'file', attachmentName: 'report.txt' },
            ],
          },
        },
      ],
      commonMistakes: ['Do not use plain assistant prose when the final answer should appear as a Discord-native rich message.', 'Do not provide content with presentation=components_v2.', 'Every file/media attachmentName referenced in Components V2 must exist in files.', 'Use action_row interactive buttons only when they materially improve the UX.'],
    },
    {
      action: 'create_poll',
      purpose: 'Create a Discord poll.',
      useWhen: ['The user explicitly wants a poll instead of a plain message.'],
      requiredFields: ['action', 'question', 'answers'],
      optionalFields: ['channelId', 'durationHours', 'allowMultiselect', 'reason'],
      restrictions: ['Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'create_poll', question: 'Ship on Friday?', answers: ['Yes', 'No'], durationHours: 24 }],
    },
    {
      action: 'add_reaction',
      purpose: 'Add a reaction to a message.',
      useWhen: ['The user wants a lightweight acknowledgement or vote reaction.'],
      requiredFields: ['action', 'messageId', 'emoji'],
      optionalFields: ['channelId', 'reason'],
      restrictions: ['Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'add_reaction', messageId: '987654321', emoji: '✅' }],
    },
    {
      action: 'remove_self_reaction',
      purpose: 'Remove Sage’s own reaction from a message.',
      useWhen: ['The user wants a prior Sage reaction removed.'],
      requiredFields: ['action', 'messageId', 'emoji'],
      optionalFields: ['channelId', 'reason'],
      restrictions: ['Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'remove_self_reaction', messageId: '987654321', emoji: '✅' }],
    },
  ],
});

export const discordServerToolDoc = registerRoutedToolDoc({
  tool: 'discord_server',
  purpose:
    'Inspect guild resources and manage thread lifecycle: channels, roles, members, permission snapshots, scheduled events, AutoMod rules, and thread operations.',
  useWhen: [
    'You need guild-resource metadata that is not message history, memory, or attachment recall.',
    'You need thread lifecycle actions or thread inspection.',
  ],
  avoidWhen: [
    'You need exact message evidence or Discord-native reply delivery; use discord_messages.',
    'You need memory, summaries, instructions reads, or analytics; use discord_context.',
    'You need cached file recall or attachment search; use discord_files.',
    'You need approval-gated admin writes; use discord_admin.',
  ],
  routingNotes: [
    'Public reads are permission-filtered to channels the requester can access.',
    'list_members, get_member, get_permission_snapshot, and list_automod_rules are admin-only reads.',
    'All write actions are disabled in autopilot turns.',
    'Archived thread lookup currently requires parentChannelId.',
  ],
  selectionHints: [
    'IF the request is about Discord guild resources or thread lifecycle -> discord_server.',
    '  - Channel or category inventory -> list_channels / get_channel.',
    '  - Role inventory -> list_roles.',
    '  - Thread discovery or thread state -> list_threads / get_thread.',
    '  - Scheduled events -> list_scheduled_events / get_scheduled_event.',
    '  - Admin-only member lookup, permission snapshots, or AutoMod rules -> list_members / get_member / get_permission_snapshot / list_automod_rules.',
    '  - Thread lifecycle writes -> create_thread / update_thread / join_thread / leave_thread / add_thread_member / remove_thread_member.',
    '  - If unsure which server action fits, call discord_server: help.',
  ],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for discord_server.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'list_channels',
      purpose: 'List accessible guild channels and categories.',
      useWhen: ['You need to inspect the server channel layout or discover target channels.'],
      requiredFields: ['action'],
      optionalFields: ['type', 'limit'],
      defaults: ['Returns permission-filtered accessible channels.', 'limit defaults to 50.'],
      examples: [{ action: 'list_channels', type: 'forum', limit: 10 }],
    },
    {
      action: 'get_channel',
      purpose: 'Retrieve detailed metadata for one guild channel.',
      useWhen: ['You need channel metadata, permission overwrites, forum/media settings, or thread-capable details.'],
      requiredFields: ['action', 'channelId'],
      restrictions: ['Requester must be able to view the target channel.'],
      examples: [{ action: 'get_channel', channelId: '1234567890' }],
    },
    {
      action: 'list_roles',
      purpose: 'List guild roles with compact permission summaries.',
      useWhen: ['The user asks about available roles or role capability differences.'],
      requiredFields: ['action'],
      optionalFields: ['limit'],
      defaults: ['limit defaults to 50.'],
      examples: [{ action: 'list_roles', limit: 20 }],
    },
    {
      action: 'list_threads',
      purpose: 'List active guild threads, optionally including archived threads under one parent channel.',
      useWhen: ['You need to discover active threads or review thread state for one channel.'],
      requiredFields: ['action'],
      optionalFields: ['parentChannelId', 'includeArchived', 'limit'],
      defaults: ['limit defaults to 50.', 'Returns active threads by default.'],
      restrictions: ['includeArchived currently requires parentChannelId.'],
      examples: [{ action: 'list_threads', parentChannelId: '1234567890', includeArchived: true, limit: 10 }],
    },
    {
      action: 'get_thread',
      purpose: 'Retrieve detailed metadata for one thread.',
      useWhen: ['You need thread archive/lock state, ownership, parent channel, or thread counts.'],
      requiredFields: ['action', 'threadId'],
      restrictions: ['Requester must be able to view the target thread.'],
      examples: [{ action: 'get_thread', threadId: '1234567890' }],
    },
    {
      action: 'list_scheduled_events',
      purpose: 'List scheduled events for the active guild.',
      useWhen: ['The user asks about upcoming or active server events.'],
      requiredFields: ['action'],
      optionalFields: ['includeCompleted', 'limit'],
      defaults: ['Completed/canceled events are omitted unless includeCompleted=true.', 'limit defaults to 50.'],
      examples: [{ action: 'list_scheduled_events', limit: 10 }],
    },
    {
      action: 'get_scheduled_event',
      purpose: 'Retrieve one scheduled event.',
      useWhen: ['You need precise details for a specific event.'],
      requiredFields: ['action', 'eventId'],
      examples: [{ action: 'get_scheduled_event', eventId: '1234567890' }],
    },
    {
      action: 'list_members',
      purpose: 'List guild members with optional query/role filtering.',
      useWhen: ['An admin needs to inspect members or narrow by query/role.'],
      requiredFields: ['action'],
      optionalFields: ['query', 'roleId', 'limit'],
      defaults: ['limit defaults to 25.'],
      restrictions: ['Admin-only read.'],
      examples: [{ action: 'list_members', query: 'alex', limit: 10 }],
    },
    {
      action: 'get_member',
      purpose: 'Retrieve one guild member.',
      useWhen: ['An admin needs details for one member.'],
      requiredFields: ['action', 'userId'],
      restrictions: ['Admin-only read.'],
      examples: [{ action: 'get_member', userId: '1234567890' }],
    },
    {
      action: 'get_permission_snapshot',
      purpose: 'Resolve permissions for either one member or one role in one channel.',
      useWhen: ['An admin needs to verify why a user or role can or cannot do something in a channel.'],
      requiredFields: ['action', 'channelId'],
      optionalFields: ['userId', 'roleId'],
      restrictions: ['Admin-only read.', 'Provide exactly one of userId or roleId.'],
      examples: [{ action: 'get_permission_snapshot', channelId: '1234567890', userId: '2222222222' }],
      commonMistakes: ['Do not send both userId and roleId.'],
    },
    {
      action: 'list_automod_rules',
      purpose: 'List AutoMod rules for the active guild.',
      useWhen: ['An admin needs a compact view of current AutoMod coverage.'],
      requiredFields: ['action'],
      optionalFields: ['limit'],
      defaults: ['limit defaults to 50.'],
      restrictions: ['Admin-only read.'],
      examples: [{ action: 'list_automod_rules', limit: 10 }],
    },
    {
      action: 'create_thread',
      purpose: 'Create a new thread, optionally from a message.',
      useWhen: ['The user wants a side conversation or focused follow-up thread.'],
      requiredFields: ['action', 'name'],
      optionalFields: ['messageId', 'channelId', 'autoArchiveDurationMinutes', 'reason'],
      restrictions: ['Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'create_thread', name: 'Release follow-up', messageId: '987654321' }],
    },
    {
      action: 'update_thread',
      purpose: 'Rename or change archive/lock settings for a thread.',
      useWhen: ['The user wants to archive, reopen, lock, unlock, rename, or retime a thread.'],
      requiredFields: ['action', 'threadId'],
      optionalFields: ['name', 'archived', 'locked', 'autoArchiveDurationMinutes', 'reason'],
      restrictions: ['Disabled in autopilot turns.', 'Requires ManageThreads permissions.'],
      examples: [{ action: 'update_thread', threadId: '1234567890', archived: true, reason: 'Resolved' }],
    },
    {
      action: 'join_thread',
      purpose: 'Join a thread as Sage.',
      useWhen: ['The user wants Sage to participate in a thread it is not currently in.'],
      requiredFields: ['action', 'threadId'],
      optionalFields: ['reason'],
      restrictions: ['Disabled in autopilot turns.'],
      examples: [{ action: 'join_thread', threadId: '1234567890' }],
    },
    {
      action: 'leave_thread',
      purpose: 'Leave a thread as Sage.',
      useWhen: ['The user wants Sage to stop participating in a thread.'],
      requiredFields: ['action', 'threadId'],
      optionalFields: ['reason'],
      restrictions: ['Disabled in autopilot turns.'],
      examples: [{ action: 'leave_thread', threadId: '1234567890' }],
    },
    {
      action: 'add_thread_member',
      purpose: 'Add a member to a thread.',
      useWhen: ['The user wants another member added to a thread.'],
      requiredFields: ['action', 'threadId', 'userId'],
      optionalFields: ['reason'],
      restrictions: ['Disabled in autopilot turns.', 'Requires ManageThreads permissions.'],
      examples: [{ action: 'add_thread_member', threadId: '1234567890', userId: '2222222222' }],
    },
    {
      action: 'remove_thread_member',
      purpose: 'Remove a member from a thread.',
      useWhen: ['The user wants another member removed from a thread.'],
      requiredFields: ['action', 'threadId', 'userId'],
      optionalFields: ['reason'],
      restrictions: ['Disabled in autopilot turns.', 'Requires ManageThreads permissions.'],
      examples: [{ action: 'remove_thread_member', threadId: '1234567890', userId: '2222222222' }],
    },
  ],
});

export const discordFilesToolDoc = registerRoutedToolDoc({
  tool: 'discord_files',
  purpose:
    'Discover, search, page through, and resend cached Discord attachments and attachment-derived text.',
  useWhen: [
    'The user asks about uploaded files or wants a cached attachment shown again.',
    'You need attachment recall or indexed attachment text.',
  ],
  avoidWhen: [
    'The user needs message history rather than files; use discord_messages.',
    'The user needs summaries or profile context; use discord_context.',
    'The user needs guild-resource metadata or thread lifecycle; use discord_server.',
  ],
  routingNotes: [
    'Use list_* or find_* for discovery.',
    'Use read_attachment for paged reads.',
    'Use send_attachment when the user wants the original file shown again.',
  ],
  selectionHints: [
    'IF the question is about Discord attachment discovery, paging, or resend flows -> discord_files.',
    '  - Cached attachment recall -> read_attachment or send_attachment; discovery first via find_* / list_*.',
    '  - Current-channel attachment discovery -> list_channel / find_channel.',
    '  - Server-wide attachment discovery -> list_server / find_server.',
    '  - If unsure which file action fits, call discord_files: help.',
  ],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for discord_files.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'list_channel',
      purpose: 'List cached attachments in the current channel.',
      useWhen: ['You need to discover files from the current channel before choosing a specific attachment.'],
      requiredFields: ['action'],
      optionalFields: ['query', 'messageId', 'filename', 'limit', 'includeContent', 'maxChars'],
      defaults: ['Operates on the current channel only.'],
      examples: [{ action: 'list_channel', filename: 'agenda', limit: 5 }],
    },
    {
      action: 'list_server',
      purpose: 'List cached attachments across the guild.',
      useWhen: ['You need broad server-wide attachment discovery.'],
      requiredFields: ['action'],
      optionalFields: ['query', 'messageId', 'filename', 'limit', 'includeContent', 'maxChars'],
      restrictions: ['Disabled in autopilot turns.'],
      examples: [{ action: 'list_server', filename: 'roadmap', limit: 10 }],
    },
    {
      action: 'find_channel',
      purpose: 'Search indexed attachment text in the current channel.',
      useWhen: ['You need semantic/text search over channel attachments.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['topK', 'maxChars'],
      defaults: ['Operates on the current channel only.'],
      examples: [{ action: 'find_channel', query: 'SLA breach runbook', topK: 5 }],
    },
    {
      action: 'find_server',
      purpose: 'Search indexed attachment text across the guild.',
      useWhen: ['You need broad attachment search across channels.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['topK', 'maxChars'],
      restrictions: ['Disabled in autopilot turns.'],
      examples: [{ action: 'find_server', query: 'postmortem template', topK: 5 }],
    },
    {
      action: 'read_attachment',
      purpose: 'Read cached attachment text or image-recall text in pages.',
      useWhen: ['You already know the attachmentId and need the stored content.'],
      requiredFields: ['action', 'attachmentId'],
      optionalFields: ['startChar', 'maxChars'],
      restrictions: ['Disabled in autopilot turns.'],
      resultNotes: ['Use returned continuation fields to continue paging when more content exists.'],
      examples: [{ action: 'read_attachment', attachmentId: 'att-123', startChar: 0, maxChars: 3000 }],
    },
    {
      action: 'send_attachment',
      purpose: 'Resend a cached attachment and return its stored content for grounding.',
      useWhen: ['The user wants the original file shown again in-channel.'],
      requiredFields: ['action', 'attachmentId'],
      optionalFields: ['channelId', 'content', 'reason', 'startChar', 'maxChars'],
      defaults: ['channelId defaults to the current channel.'],
      restrictions: ['Disabled in autopilot turns.'],
      examples: [{ action: 'send_attachment', attachmentId: 'att-123', content: 'Reposting this file.' }],
      commonMistakes: ['Use read_attachment when you only need the text; use send_attachment when the file should be shown again in Discord.'],
    },
  ],
});

export const discordAdminToolDoc = registerRoutedToolDoc({
  tool: 'discord_admin',
  purpose:
    'Perform guild administration and approval-gated Discord writes: server instruction updates, moderation requests, message edits/deletes/pins, channel and role management, member role changes, OAuth invite URLs, and raw Discord API fallback.',
  useWhen: [
    'The task changes guild configuration or performs admin actions.',
    'Typed admin actions are needed, or raw Discord API fallback is required.',
  ],
  avoidWhen: [
    'A typed non-admin message or file action already covers the task.',
    'A typed discord_server action already covers the guild-resource read or thread workflow.',
    'The task is read-only context, message search, or attachment recall.',
  ],
  routingNotes: [
    'Most actions require guild context.',
    'Admin privileges are required for all mutating actions.',
    'api is the fallback only when typed discord_server or discord_admin actions do not cover the job.',
  ],
  selectionHints: [
    'IF the task requires Discord admin writes or raw Discord REST fallback -> discord_admin.',
    '  - Server key status/clear/setup card, server instruction updates, moderation, message edit/delete/pin, channels, roles, and member role changes -> typed discord_admin actions.',
    '  - Installation link generation -> get_invite_url.',
    '  - Unsupported admin-grade guild-scoped reads/writes after typed-action checks -> api.',
    '  - If unsure which admin action fits, call discord_admin: help.',
  ],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for discord_admin.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'get_server_key_status',
      purpose: 'Check the current server-wide BYOP key status.',
      useWhen: ['An admin asks whether the server key is set or valid.'],
      requiredFields: ['action'],
      restrictions: ['Requires admin context.', 'Requires guild context.'],
      examples: [{ action: 'get_server_key_status' }],
    },
    {
      action: 'clear_server_api_key',
      purpose: 'Clear the current server-wide BYOP key immediately.',
      useWhen: ['An admin explicitly wants to remove the current server key.'],
      requiredFields: ['action'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'clear_server_api_key' }],
    },
    {
      action: 'send_key_setup_card',
      purpose: 'Send the commandless interactive server-key setup card into the current channel.',
      useWhen: ['An admin wants Sage to guide secure key setup without slash commands.'],
      requiredFields: ['action'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'send_key_setup_card' }],
    },
    {
      action: 'update_server_instructions',
      purpose: 'Submit an admin request to update guild server instructions.',
      useWhen: ['The guild wants Sage behavior/persona instructions changed.'],
      requiredFields: ['action', 'request'],
      optionalFields: ['request.text'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'update_server_instructions', request: { operation: 'set', text: 'Be concise.', reason: 'Policy refresh' } }],
    },
    {
      action: 'submit_moderation',
      purpose: 'Queue a moderation action using the moderation request schema.',
      useWhen: ['The task is a moderation workflow rather than a generic Discord write.'],
      requiredFields: ['action', 'request'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'submit_moderation', request: { action: 'timeout_member', userId: '123', durationMinutes: 30, reason: 'Spam' } }],
    },
    {
      action: 'edit_message',
      purpose: 'Queue an approval-gated edit for an existing message.',
      useWhen: ['An existing bot message needs correction.'],
      requiredFields: ['action', 'messageId', 'content'],
      optionalFields: ['channelId', 'reason'],
      defaults: ['channelId defaults to the current channel.'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'edit_message', messageId: '123', content: 'Updated content' }],
    },
    {
      action: 'delete_message',
      purpose: 'Queue an approval-gated delete for a message.',
      useWhen: ['A message should be removed by admin action.'],
      requiredFields: ['action', 'messageId'],
      optionalFields: ['channelId', 'reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'delete_message', messageId: '123', reason: 'Cleanup' }],
    },
    {
      action: 'pin_message',
      purpose: 'Queue an approval-gated pin for a message.',
      useWhen: ['A message should be pinned in the channel.'],
      requiredFields: ['action', 'messageId'],
      optionalFields: ['channelId', 'reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'pin_message', messageId: '123' }],
    },
    {
      action: 'unpin_message',
      purpose: 'Queue an approval-gated unpin for a message.',
      useWhen: ['A previously pinned message should be unpinned.'],
      requiredFields: ['action', 'messageId'],
      optionalFields: ['channelId', 'reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'unpin_message', messageId: '123' }],
    },
    {
      action: 'create_channel',
      purpose: 'Queue creation of a text, voice, or category channel.',
      useWhen: ['The guild needs a new channel or category.'],
      requiredFields: ['action', 'name'],
      optionalFields: ['type', 'parentId', 'topic', 'nsfw', 'rateLimitPerUser', 'reason'],
      defaults: ['type defaults to text.'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      resultNotes: ['topic and rateLimitPerUser apply only to text channels.'],
      examples: [{ action: 'create_channel', name: 'incident-room', type: 'text', topic: 'Active incident coordination' }],
    },
    {
      action: 'edit_channel',
      purpose: 'Queue an edit for an existing channel.',
      useWhen: ['Channel settings need updating.'],
      requiredFields: ['action', 'channelId'],
      optionalFields: ['name', 'parentId', 'topic', 'nsfw', 'rateLimitPerUser', 'reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'edit_channel', channelId: '123', topic: 'Updated topic' }],
    },
    {
      action: 'create_role',
      purpose: 'Queue creation of a new role.',
      useWhen: ['A guild role should be created.'],
      requiredFields: ['action', 'name'],
      optionalFields: ['colorHex', 'hoist', 'mentionable', 'permissions', 'reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'create_role', name: 'On Call', colorHex: '#ff0000', permissions: '8' }],
    },
    {
      action: 'edit_role',
      purpose: 'Queue an edit to an existing role.',
      useWhen: ['A role’s settings or permissions must change.'],
      requiredFields: ['action', 'roleId'],
      optionalFields: ['name', 'colorHex', 'hoist', 'mentionable', 'permissions', 'reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'edit_role', roleId: '456', mentionable: true }],
    },
    {
      action: 'delete_role',
      purpose: 'Queue deletion of a role.',
      useWhen: ['A role should be removed.'],
      requiredFields: ['action', 'roleId'],
      optionalFields: ['reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'delete_role', roleId: '456', reason: 'Unused role' }],
    },
    {
      action: 'add_member_role',
      purpose: 'Queue adding a role to a member.',
      useWhen: ['A member needs a role assignment.'],
      requiredFields: ['action', 'userId', 'roleId'],
      optionalFields: ['reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'add_member_role', userId: '123', roleId: '456' }],
    },
    {
      action: 'remove_member_role',
      purpose: 'Queue removing a role from a member.',
      useWhen: ['A member’s role assignment should be removed.'],
      requiredFields: ['action', 'userId', 'roleId'],
      optionalFields: ['reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'remove_member_role', userId: '123', roleId: '456' }],
    },
    {
      action: 'get_invite_url',
      purpose: 'Generate a guild installation invite URL for the bot.',
      useWhen: ['The user wants an installation link.'],
      requiredFields: ['action'],
      optionalFields: ['permissions', 'scopes', 'guildId', 'disableGuildSelect'],
      defaults: ['scopes default to bot.', 'permissions default to 0 when bot scope is present.'],
      examples: [{ action: 'get_invite_url', guildId: '123', disableGuildSelect: true }],
    },
    {
      action: 'api',
      purpose: 'Use guild-scoped raw Discord REST as an admin fallback when typed actions do not cover the task.',
      useWhen: ['An admin-grade guild-scoped read or write is unsupported by typed actions.'],
      avoidWhen: ['A typed action already covers the task.', 'The task is normal message sending.'],
      requiredFields: ['action', 'method', 'path'],
      optionalFields: ['query', 'body', 'multipartBodyMode', 'files', 'reason', 'maxResponseChars'],
      restrictions: ['Requires admin context.', 'Non-GET requests require approval.', 'Disabled in autopilot turns.', 'Requires guild context.', 'Bot-wide endpoints like /users/@me and direct /webhooks/* routes are blocked.'],
      resultNotes: ['Sensitive fields are redacted from API results.'],
      examples: [{ action: 'api', method: 'GET', path: '/channels/123/messages/456' }],
      commonMistakes: ['Do not use api for normal message sending; use discord_messages send.', 'Do not assume api is available in non-admin turns.'],
    },
  ],
});

export const discordVoiceToolDoc = registerRoutedToolDoc({
  tool: 'discord_voice',
  purpose:
    'Control Sage live voice presence in the current guild: inspect connection status, join the invoker current voice channel, or leave the active voice channel.',
  useWhen: [
    'The user wants Sage to join or leave voice without slash commands.',
    'You need the current live voice connection state rather than voice analytics or summaries.',
  ],
  avoidWhen: [
    'You need voice analytics or past voice summaries; use discord_context.',
    'You need guild-resource metadata or thread lifecycle; use discord_server.',
  ],
  routingNotes: [
    'Join and leave are disabled in autopilot turns.',
    'join_current_channel requires the invoker to already be in a standard voice channel.',
    'Stage channels are not supported.',
  ],
  selectionHints: [
    'IF the request is about live voice presence or commandless voice control -> discord_voice.',
    '  - Is Sage currently in voice? -> get_status.',
    '  - Join my current voice channel -> join_current_channel.',
    '  - Leave the active voice channel -> leave.',
    '  - If unsure which voice action fits, call discord_voice: help.',
  ],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for discord_voice.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'get_status',
      purpose: 'Show the current live voice connection state for this guild.',
      useWhen: ['The user asks whether Sage is currently connected to voice.'],
      requiredFields: ['action'],
      restrictions: ['Requires guild context.'],
      examples: [{ action: 'get_status' }],
    },
    {
      action: 'join_current_channel',
      purpose: 'Join the invoker current standard voice channel.',
      useWhen: ['The user explicitly asks Sage to join the voice channel they are already in.'],
      requiredFields: ['action'],
      restrictions: ['Disabled in autopilot turns.', 'Requires guild context.', 'Stage channels are not supported.'],
      examples: [{ action: 'join_current_channel' }],
    },
    {
      action: 'leave',
      purpose: 'Leave the active guild voice channel.',
      useWhen: ['The user explicitly asks Sage to leave voice.'],
      requiredFields: ['action'],
      restrictions: ['Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'leave' }],
    },
  ],
});

export const webToolDoc = registerRoutedToolDoc({
  tool: 'web',
  purpose: 'Research public internet information with search, page reads, targeted extraction, and one-shot grounded research.',
  useWhen: ['The answer needs fresh or source-grounded public web data.'],
  avoidWhen: ['The answer is purely Discord-internal.', 'A GitHub repo or npm package tool is a better source.'],
  routingNotes: ['Use research for one-shot search + read.', 'Use read.page for very large pages.'],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for web.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'search',
      purpose: 'Search the public web and return grounded results.',
      useWhen: ['You need discovery or source selection.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['depth', 'maxResults'],
      defaults: ['depth defaults to the runtime search profile.'],
      examples: [{ action: 'search', query: 'latest Node.js release notes', depth: 'balanced', maxResults: 5 }],
    },
    {
      action: 'read',
      purpose: 'Fetch the main content from a known URL.',
      useWhen: ['You already know the page you want to read.'],
      requiredFields: ['action', 'url'],
      optionalFields: ['maxChars'],
      examples: [{ action: 'read', url: 'https://example.com/docs', maxChars: 4000 }],
    },
    {
      action: 'read.page',
      purpose: 'Read a known URL in pages with continuation support.',
      useWhen: ['The page is large and all-or-nothing output would be wasteful.'],
      requiredFields: ['action', 'url'],
      optionalFields: ['contentId', 'startChar', 'maxChars', 'fetchMaxChars'],
      resultNotes: ['Use contentId + nextStartChar from the result to continue paging.'],
      examples: [{ action: 'read.page', url: 'https://example.com/docs', maxChars: 2000 }],
      commonMistakes: ['Use read.page instead of read when you expect a very large page.'],
    },
    {
      action: 'extract',
      purpose: 'Run targeted extraction against a URL with explicit instructions.',
      useWhen: ['Raw page content is not enough and the user needs focused extraction.'],
      requiredFields: ['action', 'url', 'instruction'],
      optionalFields: ['maxChars'],
      examples: [{ action: 'extract', url: 'https://example.com/pricing', instruction: 'Extract plan names and monthly prices.' }],
    },
    {
      action: 'research',
      purpose: 'Run one-shot search plus grounded reads of top sources.',
      useWhen: ['You want a compact search + read workflow in one call.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['depth', 'maxResults', 'maxSources', 'perSourceMaxChars', 'followLinks', 'maxFollowedLinks', 'maxFollowedLinksPerSource', 'followSameDomainOnly', 'perFollowMaxChars'],
      defaults: ['followSameDomainOnly defaults to true.'],
      resultNotes: ['May return followQueue guidance if more discovered links remain unfollowed.'],
      examples: [{ action: 'research', query: 'HTTP 429 retry best practices', maxSources: 3, followLinks: true, maxFollowedLinks: 3 }],
    },
  ],
});

export const githubToolDoc = registerRoutedToolDoc({
  tool: 'github',
  purpose: 'Read GitHub repository metadata, code search, file content, issues, pull requests, and commit activity.',
  useWhen: ['The request is about GitHub repository data or source files.'],
  avoidWhen: ['The package source is unknown and npm_info or workflow can resolve it first.', 'The request is general web research rather than GitHub data.'],
  routingNotes: ['When the path is unknown, start with code.search.', 'Prefer file.page, file.ranges, or file.snippet for large files.'],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for github.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'repo.get',
      purpose: 'Fetch GitHub repository metadata, optionally including the README.',
      requiredFields: ['action', 'repo'],
      optionalFields: ['includeReadme'],
      resultNotes: ['repo accepts owner/repo or a GitHub URL and is normalized internally.'],
      examples: [{ action: 'repo.get', repo: 'microsoft/TypeScript', includeReadme: true }],
      useWhen: ['You need repo metadata before going deeper.'],
    },
    {
      action: 'code.search',
      purpose: 'Search code across a GitHub repository.',
      requiredFields: ['action', 'repo', 'query'],
      optionalFields: ['ref', 'regex', 'pathFilter', 'maxCandidates', 'maxFilesToScan', 'maxMatches', 'includeTextMatches'],
      useWhen: ['The file path is unknown or you need candidate source locations.'],
      examples: [{ action: 'code.search', repo: 'microsoft/TypeScript', query: 'createProgram', includeTextMatches: true }],
    },
    {
      action: 'file.get',
      purpose: 'Fetch file contents, optionally with a single contiguous line range.',
      requiredFields: ['action', 'repo', 'path'],
      optionalFields: ['ref', 'maxChars', 'startLine', 'endLine', 'includeLineNumbers'],
      restrictions: ['startLine and endLine must be provided together.'],
      useWhen: ['You know the exact file path and want the file or one contiguous range.'],
      examples: [{ action: 'file.get', repo: 'microsoft/TypeScript', path: 'src/compiler/program.ts', startLine: 1, endLine: 80 }],
    },
    {
      action: 'file.page',
      purpose: 'Read a file in pages.',
      requiredFields: ['action', 'repo', 'path'],
      optionalFields: ['ref', 'maxChars', 'startLine', 'maxLines', 'includeLineNumbers'],
      useWhen: ['The file is large and paging is preferable.'],
      examples: [{ action: 'file.page', repo: 'microsoft/TypeScript', path: 'src/compiler/program.ts', startLine: 1, maxLines: 200 }],
    },
    {
      action: 'file.ranges',
      purpose: 'Fetch multiple disjoint ranges from a file in one call.',
      requiredFields: ['action', 'repo', 'path', 'ranges'],
      optionalFields: ['ref', 'maxChars', 'includeLineNumbers'],
      useWhen: ['You need several specific code sections at once.'],
      examples: [{ action: 'file.ranges', repo: 'microsoft/TypeScript', path: 'src/compiler/program.ts', ranges: [{ startLine: 10, endLine: 20 }, { startLine: 200, endLine: 220 }] }],
    },
    {
      action: 'file.snippet',
      purpose: 'Fetch a tight snippet around a line number.',
      requiredFields: ['action', 'repo', 'path', 'lineNumber'],
      optionalFields: ['ref', 'before', 'after', 'maxChars', 'includeLineNumbers'],
      useWhen: ['You know the focal line number and want local context only.'],
      examples: [{ action: 'file.snippet', repo: 'microsoft/TypeScript', path: 'src/compiler/program.ts', lineNumber: 250, before: 10, after: 12 }],
    },
    {
      action: 'issues.search',
      purpose: 'Search issues within a GitHub repository.',
      requiredFields: ['action', 'repo', 'query'],
      optionalFields: ['state', 'maxResults'],
      useWhen: ['The request is about issue discussions or bug history.'],
      examples: [{ action: 'issues.search', repo: 'microsoft/TypeScript', query: 'incremental build regression', state: 'open' }],
    },
    {
      action: 'prs.search',
      purpose: 'Search pull requests within a GitHub repository.',
      requiredFields: ['action', 'repo', 'query'],
      optionalFields: ['state', 'maxResults'],
      useWhen: ['The request is about code review or merged PR history.'],
      examples: [{ action: 'prs.search', repo: 'microsoft/TypeScript', query: 'tsserver perf', state: 'all' }],
    },
    {
      action: 'commits.list',
      purpose: 'List recent commits for a repo or a repo/ref/path slice.',
      requiredFields: ['action', 'repo'],
      optionalFields: ['ref', 'path', 'sinceIso', 'limit'],
      useWhen: ['The request is about recent repository activity.'],
      examples: [{ action: 'commits.list', repo: 'microsoft/TypeScript', path: 'src/compiler/program.ts', limit: 10 }],
    },
  ],
});

export const workflowToolDoc = registerRoutedToolDoc({
  tool: 'workflow',
  purpose: 'Use one-shot composed tool chains to reduce latency and failure points for common multi-hop tasks.',
  useWhen: ['A composed workflow can replace multiple manual tool hops.'],
  avoidWhen: ['A direct tool call is simpler or the workflow does not match the task.'],
  routingNotes: ['Workflow actions are convenience wrappers over lower-level tools.'],
  actions: [
    {
      action: 'help',
      purpose: 'Show action contracts for workflow.',
      useWhen: ['The action or field contract is unclear.'],
      requiredFields: ['action'],
      examples: [{ action: 'help' }],
    },
    {
      action: 'npm.github_code_search',
      purpose: 'Resolve an npm package’s GitHub repo and immediately run GitHub code search.',
      useWhen: ['You want npm package resolution plus GitHub code search in one call.'],
      requiredFields: ['action', 'packageName', 'query'],
      optionalFields: ['version', 'ref', 'regex', 'pathFilter', 'maxCandidates', 'maxFilesToScan', 'maxMatches', 'includeTextMatches'],
      resultNotes: ['Fails with not_found when the package metadata does not expose a GitHub repo.'],
      examples: [{ action: 'npm.github_code_search', packageName: 'zod', query: 'safeParse', includeTextMatches: true }],
    },
  ],
});
