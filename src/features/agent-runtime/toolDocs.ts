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

export interface RoutedToolRepairActionContract {
  action: string;
  purpose: string;
  requiredFields: string[];
  optionalFields: string[];
  commonMistakes: string[];
}

export interface RoutedToolRepairGuidance {
  tool: string;
  kind: 'missing_action' | 'unknown_action' | 'invalid_action_payload';
  suggestedActions: string[];
  actionContract?: RoutedToolRepairActionContract;
  nextStepHint: string;
}

export interface PromptToolGuidance {
  purpose?: string;
  decisionEdges: string[];
  antiPatterns?: string[];
  helpHint?: string;
}

export type WebsiteToolCategory = 'discord' | 'search' | 'dev' | 'gen' | 'system';

export interface WebsiteNativeToolRow {
  name: string;
  short: string;
  desc: string;
  cat: WebsiteToolCategory;
  color: string;
}

export interface ToolSmokeDoc {
  mode: 'required' | 'optional' | 'skip';
  args?: Record<string, unknown>;
  reason?: string;
}

export interface TopLevelToolDoc {
  tool: string;
  purpose: string;
  selectionHints: string[];
  avoidWhen?: string[];
  promptGuidance?: PromptToolGuidance;
  validationHint?: string;
  website: WebsiteNativeToolRow;
  smoke: ToolSmokeDoc;
}

const routedToolDocs = new Map<string, RoutedToolDoc>();
const topLevelToolDocs = new Map<string, TopLevelToolDoc>();

function registerRoutedToolDoc(doc: RoutedToolDoc): RoutedToolDoc {
  routedToolDocs.set(doc.tool, doc);
  return doc;
}

function registerTopLevelToolDoc(doc: TopLevelToolDoc): TopLevelToolDoc {
  topLevelToolDocs.set(doc.tool, doc);
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

function normalizeToolActionName(value: string): string {
  return value.trim().toLowerCase();
}

const MAX_ACTION_SUGGESTION_QUERY_CHARS = 128;

function toRepairActionContract(action: RoutedToolActionDoc): RoutedToolRepairActionContract {
  return {
    action: action.action,
    purpose: action.purpose,
    requiredFields: [...(action.requiredFields ?? [])],
    optionalFields: [...(action.optionalFields ?? [])],
    commonMistakes: [...(action.commonMistakes ?? [])],
  };
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function rankSuggestedActions(
  query: string,
  actions: RoutedToolActionDoc[],
  limit = 3,
): RoutedToolActionDoc[] {
  const normalizedQuery = normalizeToolActionName(query);
  if (!normalizedQuery) {
    return actions.slice(0, limit);
  }

  if (normalizedQuery.length > MAX_ACTION_SUGGESTION_QUERY_CHARS) {
    const prefixMatches = actions.filter((action) => {
      const normalizedAction = normalizeToolActionName(action.action);
      return (
        normalizedAction.startsWith(normalizedQuery) ||
        normalizedQuery.startsWith(normalizedAction)
      );
    });
    return (prefixMatches.length > 0 ? prefixMatches : actions).slice(0, limit);
  }

  const threshold = Math.max(2, Math.floor(normalizedQuery.length / 2));
  const scored = actions.map((action, index) => {
    const normalizedAction = normalizeToolActionName(action.action);
    const prefixMatch =
      normalizedAction.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedAction);
    return {
      action,
      index,
      prefixMatch,
      distance: levenshteinDistance(normalizedQuery, normalizedAction),
    };
  });

  const ranked = scored
    .filter((entry) => entry.prefixMatch || entry.distance <= threshold)
    .sort(
      (left, right) =>
        Number(right.prefixMatch) - Number(left.prefixMatch) ||
        left.distance - right.distance ||
        left.index - right.index,
    )
    .slice(0, limit)
    .map((entry) => entry.action);

  return ranked.length > 0 ? ranked : actions.slice(0, limit);
}

function readRequestedAction(args: unknown): string | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null;
  }
  const action = (args as Record<string, unknown>).action;
  return typeof action === 'string' && action.trim().length > 0 ? action.trim() : null;
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

export function getTopLevelToolDoc(toolName: string): TopLevelToolDoc | null {
  return topLevelToolDocs.get(toolName) ?? null;
}

export function listTopLevelToolDocs(): TopLevelToolDoc[] {
  return [...topLevelToolDocs.values()];
}

export function getTopLevelToolSelectionHints(toolName: string): string[] {
  const doc = getTopLevelToolDoc(toolName);
  return doc ? [...doc.selectionHints] : [];
}

export function getPromptToolGuidance(toolName: string): PromptToolGuidance | null {
  const doc = getTopLevelToolDoc(toolName);
  if (!doc?.promptGuidance) {
    return null;
  }

  return {
    purpose: doc.promptGuidance.purpose,
    decisionEdges: [...doc.promptGuidance.decisionEdges],
    antiPatterns: doc.promptGuidance.antiPatterns
      ? [...doc.promptGuidance.antiPatterns]
      : undefined,
    helpHint: doc.promptGuidance.helpHint,
  };
}

export function getToolValidationHint(toolName: string): string | undefined {
  return getTopLevelToolDoc(toolName)?.validationHint;
}

export function buildRoutedToolRepairGuidance(
  toolName: string,
  args: unknown,
): RoutedToolRepairGuidance | undefined {
  const doc = getRoutedToolDoc(toolName);
  if (!doc) return undefined;

  const requestedAction = readRequestedAction(args);
  const helpAction = doc.actions.find((action) => normalizeToolActionName(action.action) === 'help');

  if (!requestedAction) {
    return {
      tool: doc.tool,
      kind: 'missing_action',
      suggestedActions: doc.actions.slice(0, 3).map((action) => action.action),
      actionContract: helpAction ? toRepairActionContract(helpAction) : undefined,
      nextStepHint:
        `Add an "action" field for ${doc.tool}. ` +
        `If you are unsure which action fits, call ${doc.tool} with { action: "help" } first.`,
    };
  }

  const normalizedRequestedAction = normalizeToolActionName(requestedAction);
  const matchedAction = doc.actions.find(
    (action) => normalizeToolActionName(action.action) === normalizedRequestedAction,
  );

  if (!matchedAction) {
    const suggestions = rankSuggestedActions(requestedAction, doc.actions, 3);
    return {
      tool: doc.tool,
      kind: 'unknown_action',
      suggestedActions: suggestions.map((action) => action.action),
      actionContract: suggestions[0] ? toRepairActionContract(suggestions[0]) : undefined,
      nextStepHint:
        `Action "${requestedAction}" is not valid for ${doc.tool}. ` +
        `Use one of the suggested actions instead, or call ${doc.tool} with { action: "help" } first.`,
    };
  }

  return {
    tool: doc.tool,
    kind: 'invalid_action_payload',
    suggestedActions: [...new Set([matchedAction.action, 'help'])].slice(0, 3),
    actionContract: toRepairActionContract(matchedAction),
    nextStepHint:
      `Keep action="${matchedAction.action}" and fix the payload fields. ` +
      `If you need the full contract, call ${doc.tool} with { action: "help" } first.`,
  };
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
    'Read Discord-native context surfaces for the current guild: user profiles, rolling channel summaries, Sage Persona reads, and social/voice analytics.',
  useWhen: [
    'You need server-internal context rather than public web information.',
    'You need summaries, profiles, or analytics instead of exact message-level evidence.',
    'You need the current guild Sage Persona as a behavior/persona reference rather than an admin write.',
  ],
  avoidWhen: [
    'The user needs exact message quotes or historical proof; use discord_messages instead.',
    'The user needs attachment discovery or recall; use discord_files instead.',
    'The task changes Discord state; use discord_messages or discord_admin instead.',
  ],
  routingNotes: [
    'This tool is read-only.',
    'get_channel_summary is current-channel only.',
    'get_server_instructions reads the guild Sage Persona; changing that config belongs to discord_admin.update_server_instructions.',
    'Voice analytics and voice summaries live here; live join/leave control belongs to discord_voice.',
    'get_top_relationships is read-only but disabled in autopilot turns.',
  ],
  selectionHints: [
    'IF the question is about Discord-internal profiles, summaries, instruction reads, or analytics -> discord_context.',
    '  - Rolling summary of what has been happening -> get_channel_summary.',
    '  - User identity/profile in the server -> get_user_profile.',
    '  - Guild Sage Persona read -> get_server_instructions (read-only).',
    '  - Social analytics -> get_social_graph / get_top_relationships.',
    '  - Voice analytics or past voice recaps -> get_voice_analytics / get_voice_summaries.',
    '  - Channels, roles, threads, members, events, or AutoMod -> discord_server or typed admin actions, not Sage Persona.',
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
      avoidWhen: ['The user asks for exact quotes, exact timestamps, or message-level evidence.'],
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
      purpose: 'Read the current admin-authored Sage Persona for this guild.',
      useWhen: ['You need the guild-configured Sage Persona rules for how Sage should behave.'],
      avoidWhen: ['You need to change the Sage Persona; use discord_admin.update_server_instructions instead.'],
      requiredFields: ['action'],
      optionalFields: ['maxChars'],
      restrictions: ['Requires guild context.'],
      resultNotes: ['This is Sage Persona configuration, not factual truth, memory, or an admin action result.'],
      examples: [{ action: 'get_server_instructions', maxChars: 1500 }],
      commonMistakes: ['Do not confuse this read with discord_admin.update_server_instructions, which queues an admin Sage Persona change request.'],
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
      avoidWhen: ['The user wants Sage to join or leave voice right now; use discord_voice instead.'],
      requiredFields: ['action'],
      optionalFields: ['userId', 'maxChars'],
      defaults: ['userId defaults to the current user.'],
      examples: [{ action: 'get_voice_analytics', userId: '1234567890' }],
    },
    {
      action: 'get_voice_summaries',
      purpose: 'Retrieve recent voice session summaries.',
      useWhen: ['The user wants recent voice-session recap information.'],
      avoidWhen: ['The user wants live voice connection status or join/leave control; use discord_voice instead.'],
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
    'get_context means a local window around a known message ID, not rolling channel context.',
    'Thread lifecycle belongs to discord_server.',
    'send couples message content with presentation mode; use help before guessing on plain vs components_v2 payload rules.',
    'search_guild and get_user_timeline are disabled in autopilot turns.',
  ],
  selectionHints: [
    'IF the question needs exact Discord message evidence or Discord-native delivery -> discord_messages.',
    '  - Exact quotes or what someone said -> search_history / search_with_context, not get_channel_summary.',
    '  - Known message ID + surrounding window -> get_context (message window, not summary context).',
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
      avoidWhen: ['You need a rolling summary of the channel; use discord_context.get_channel_summary instead.'],
      requiredFields: ['action', 'messageId'],
      optionalFields: ['channelId', 'before', 'after', 'maxChars'],
      defaults: ['channelId defaults to the current channel.'],
      restrictions: ['In autopilot, cross-channel lookup is disabled.'],
      examples: [{ action: 'get_context', messageId: '987654321', before: 2, after: 4 }],
      commonMistakes: ['Do not use get_context as a generic channel recap tool; it only expands around one known message ID.'],
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
      commonMistakes: ['Do not use plain assistant prose when the final answer should appear as a Discord-native rich message.', 'Do not provide content with presentation=components_v2.', 'Do not treat presentation as a cosmetic toggle; it changes payload rules.', 'Every file/media attachmentName referenced in Components V2 must exist in files.', 'Use action_row interactive buttons only when they materially improve the UX.'],
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
    'Threads are operational guild resources in this runtime, so thread lifecycle lives here rather than under discord_messages.',
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
      avoidWhen: ['You only need public channel, role, thread, or event metadata.'],
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
      avoidWhen: ['You only need a user profile summary for personalization; use discord_context.get_user_profile instead.'],
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
    'Use list_* or find_* for attachment discovery.',
    'list_channel/list_server enumerate files, not channels or guild resources.',
    'find_channel/find_server search attachment text, not message history.',
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
      avoidWhen: ['You need channel metadata or channel inventory; use discord_server.list_channels instead.'],
      requiredFields: ['action'],
      optionalFields: ['query', 'messageId', 'filename', 'limit', 'includeContent', 'maxChars'],
      defaults: ['Operates on the current channel only.'],
      examples: [{ action: 'list_channel', filename: 'agenda', limit: 5 }],
    },
    {
      action: 'list_server',
      purpose: 'List cached attachments across the guild.',
      useWhen: ['You need broad server-wide attachment discovery.'],
      avoidWhen: ['You need the server channel list; use discord_server.list_channels instead.'],
      requiredFields: ['action'],
      optionalFields: ['query', 'messageId', 'filename', 'limit', 'includeContent', 'maxChars'],
      restrictions: ['Disabled in autopilot turns.'],
      examples: [{ action: 'list_server', filename: 'roadmap', limit: 10 }],
    },
    {
      action: 'find_channel',
      purpose: 'Search indexed attachment text in the current channel.',
      useWhen: ['You need semantic/text search over channel attachments.'],
      avoidWhen: ['You need message history search; use discord_messages.search_history instead.'],
      requiredFields: ['action', 'query'],
      optionalFields: ['topK', 'maxChars'],
      defaults: ['Operates on the current channel only.'],
      examples: [{ action: 'find_channel', query: 'SLA breach runbook', topK: 5 }],
    },
    {
      action: 'find_server',
      purpose: 'Search indexed attachment text across the guild.',
      useWhen: ['You need broad attachment search across channels.'],
      avoidWhen: ['You need server-wide message search; use discord_messages.search_guild instead.'],
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
    'Perform guild administration and approval-gated Discord writes: Sage Persona updates, moderation requests, message edits/deletes/pins, channel and role management, member role changes, OAuth invite URLs, and raw Discord API fallback.',
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
    'Treat Sage Persona/config and moderation as separate admin domains: Sage Persona changes govern Sage behavior/persona/policy posture, while moderation enforces actions on users, messages, reactions, or content.',
    'Reply-targeted cleanup of someone else\'s spam/abusive/rule-breaking message is a moderation workflow, not a generic admin delete.',
    'Moderation should be evidence-first: use exact message-history tools before making a strong enforcement claim about what a message said.',
    'For high-leverage message enforcement, use submit_moderation with request.action `bulk_delete_messages` (explicit IDs/URLs) or `purge_recent_messages` (criteria-based purge resolved during preflight).',
    'Bulk moderation preflight canonicalizes targets before approval so the queued review snapshot is deterministic and replay-safe.',
    'If exact message-history tools are unavailable or insufficient, collect evidence with discord_admin.api GET /channels/{channelId}/messages before running moderation writes.',
    'submit_moderation accepts canonical Discord targeting inputs: raw IDs, mentions, Discord message URLs, and direct-reply shorthand when the target is unambiguous.',
    'api is the fallback only when typed discord_server or discord_admin actions do not cover the job.',
    'update_server_instructions changes the guild Sage Persona; get_server_instructions in discord_context only reads that config.',
    'submit_moderation is for enforcement workflows such as timeout/kick/ban/delete/reaction cleanup, not for changing how Sage behaves.',
  ],
  selectionHints: [
    'IF the task requires Discord admin writes or raw Discord REST fallback -> discord_admin.',
    '  - Governance/config for Sage or the review surface -> get_server_key_status / get_governance_review_status / set_governance_review_channel / clear_governance_review_channel / send_key_setup_card / update_server_instructions.',
    '  - Moderation/enforcement on users, messages, reactions, or content, including reply-targeted "delete this spam/abuse message" requests -> submit_moderation.',
    '  - Bulk message enforcement -> submit_moderation with request.action bulk_delete_messages (explicit IDs/URLs) or purge_recent_messages (criteria-based preflight scan).',
    '  - Bulk delete execution skips messages older than 14 days and reports skipped counts instead of failing the whole action.',
    '  - Before moderation, use discord_messages.get_context / search_with_context for exact message evidence when the current reply target or transcript is incomplete.',
    '  - If the moderation decision depends on member state, permissions, or current server guardrails -> discord_server.get_member / get_permission_snapshot / list_automod_rules.',
    '  - Channels, roles, threads, members, events, and AutoMod -> typed discord_server or discord_admin actions, not Sage Persona.',
    '  - Other admin writes such as message edits and member role changes -> typed discord_admin actions.',
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
      action: 'get_governance_review_status',
      purpose: 'Inspect how governance review cards are routed for the current server.',
      useWhen: ['An admin wants to confirm whether review cards stay in-channel or route to a dedicated review channel.'],
      requiredFields: ['action'],
      restrictions: ['Requires admin context.', 'Requires guild context.'],
      resultNotes: ['Returns the configured review channel, the effective review channel, and the current routing mode.'],
      examples: [{ action: 'get_governance_review_status' }],
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
      action: 'set_governance_review_channel',
      purpose: 'Route governance review cards to a dedicated text channel.',
      useWhen: ['An admin wants compact requester updates to stay in the source channel while detailed approvals move to a review surface.'],
      requiredFields: ['action', 'channelId'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.', 'Channel must resolve to a guild text-capable review surface.'],
      resultNotes: ['New governance requests will post reviewer cards to the configured channel and keep requester status in the source channel.'],
      examples: [{ action: 'set_governance_review_channel', channelId: '1234567890' }],
      commonMistakes: ['Do not pass a DM or non-guild channel ID.', 'Use clear_governance_review_channel to return reviewer cards to source-channel default routing.'],
    },
    {
      action: 'clear_governance_review_channel',
      purpose: 'Remove the dedicated governance review channel override.',
      useWhen: ['An admin wants reviewer cards to use the request source channel by default again.'],
      requiredFields: ['action'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      resultNotes: ['Future governance reviews will render in the source channel unless another review channel is configured later.'],
      examples: [{ action: 'clear_governance_review_channel' }],
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
      purpose: 'Submit an admin request to update the guild Sage Persona.',
      useWhen: ['The guild wants Sage Persona behavior/persona instructions changed.'],
      avoidWhen: [
        'You only need to read the current Sage Persona text; use discord_context.get_server_instructions instead.',
        'The request is really moderation or enforcement on a user, message, reaction, or piece of content; use submit_moderation instead.',
      ],
      requiredFields: ['action', 'request'],
      optionalFields: ['request.text'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'update_server_instructions', request: { operation: 'set', text: 'Be concise.', reason: 'Policy refresh' } }],
      commonMistakes: [
        'Do not use this when you only need to inspect the current Sage Persona; that is a discord_context read.',
        'Do not use this for moderation policy enforcement such as timeout_member, delete_message, or reaction cleanup; that belongs to submit_moderation.',
      ],
    },
    {
      action: 'submit_moderation',
      purpose: 'Queue a moderation/enforcement action using the moderation request schema.',
      useWhen: [
        'The task is a moderation workflow rather than a generic Discord write.',
        'A replied-to message should be deleted or acted on for spam, abuse, harassment, or rule enforcement.',
        'You need timeout, untimeout, kick, ban, unban, delete, or reaction cleanup on a concrete Discord target.',
      ],
      avoidWhen: ['The request is about Sage persona, tone, behavior rules, or server policy posture; use update_server_instructions instead.'],
      requiredFields: ['action', 'request'],
      optionalFields: [
        'request.messageId',
        'request.channelId',
        'request.userId',
        'request.messageIds',
        'request.limit',
        'request.windowMinutes',
        'request.authorUserId',
        'request.includePinned',
      ],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      resultNotes: [
        'Message and user refs accept raw IDs, mentions, Discord message URLs, or direct-reply shorthand when the runtime can resolve the target unambiguously.',
        'The moderation queue stores a canonical target snapshot so equivalent requests can coalesce onto one approval review request.',
        'request.action=bulk_delete_messages deletes explicit IDs/URLs in one approval-gated action.',
        'request.action=purge_recent_messages resolves criteria to explicit message IDs during preflight, then queues the deterministic bulk snapshot for approval.',
        'Bulk-delete execution skips messages older than 14 days and reports skipped_too_old counts in the outcome summary.',
      ],
      examples: [
        { action: 'submit_moderation', request: { action: 'timeout_member', userId: '<@123>', durationMinutes: 30, reason: 'Spam' } },
        { action: 'submit_moderation', request: { action: 'delete_message', reason: 'Reply-targeted spam cleanup' } },
        { action: 'submit_moderation', request: { action: 'bulk_delete_messages', channelId: '123', messageIds: ['111', '222'], reason: 'Raid cleanup' } },
        { action: 'submit_moderation', request: { action: 'purge_recent_messages', channelId: '123', limit: 50, windowMinutes: 60, authorUserId: '<@123>', reason: 'Purge recent spam burst' } },
        { action: 'submit_moderation', request: { action: 'untimeout_member', userId: '123', reason: 'Appeal accepted' } },
      ],
      commonMistakes: [
        'Do not use moderation to change how Sage should speak, behave, or follow guild response policy; that belongs to update_server_instructions.',
        'Do not fall back to the generic delete_message admin action when the user is asking to remove replied-to spam/abusive content as enforcement; that still belongs to moderation.',
        'Do not jump to discord_admin.api for bulk deletes or purge-style cleanup when submit_moderation already supports bulk_delete_messages and purge_recent_messages.',
        'Do not rely on `discord_context.get_channel_summary` as evidence for moderation; use exact message-history tools first.',
        'For `remove_user_reaction`, a reply target only identifies the message; you still need an explicit user target because multiple people may have reacted.',
      ],
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
      purpose: 'Queue an approval-gated direct delete for a message as a generic admin maintenance action.',
      useWhen: ['A known message should be removed as non-moderation housekeeping or operator cleanup.'],
      avoidWhen: ['The delete is enforcement against spam, abuse, harassment, or other replied-to/user-content moderation; use submit_moderation instead.'],
      requiredFields: ['action', 'messageId'],
      optionalFields: ['channelId', 'reason'],
      restrictions: ['Requires admin context.', 'Disabled in autopilot turns.', 'Requires guild context.'],
      examples: [{ action: 'delete_message', messageId: '123', reason: 'Cleanup' }],
      commonMistakes: ['Do not use this as the first choice for deleting replied-to spam/abusive user content; route that to submit_moderation.'],
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
      useWhen: [
        'An admin-grade guild-scoped read or write is unsupported by typed actions.',
        'You need moderation-adjacent fallback behavior not yet modeled as a typed action (for example, AutoMod writes).',
      ],
      avoidWhen: [
        'A typed action already covers the task.',
        'The task is normal message sending.',
        'You have not checked the typed discord_server/discord_admin actions yet.',
        'The request is bulk/purge moderation that submit_moderation already supports.',
      ],
      requiredFields: ['action', 'method', 'path'],
      optionalFields: ['query', 'body', 'multipartBodyMode', 'files', 'reason', 'maxResponseChars'],
      restrictions: ['Requires admin context.', 'Non-GET requests require approval.', 'Disabled in autopilot turns.', 'Requires guild context.', 'Bot-wide endpoints like /users/@me and direct /webhooks/* routes are blocked.'],
      resultNotes: [
        'Sensitive fields are redacted from API results.',
        'For moderation evidence fallback, use GET /channels/{channelId}/messages or /channels/{channelId}/messages/{messageId} before enforcement.',
      ],
      examples: [
        { action: 'api', method: 'GET', path: '/channels/123/messages', query: { limit: 50 } },
        { action: 'api', method: 'POST', path: '/guilds/123/auto-moderation/rules', body: { name: 'Anti-raid burst', event_type: 1 }, reason: 'Typed AutoMod write action unavailable' },
      ],
      commonMistakes: [
        'Do not use api for normal message sending; use discord_messages send.',
        'Do not use api before checking typed discord_server or discord_admin actions.',
        'Do not bypass submit_moderation for bulk_delete_messages or purge_recent_messages by default.',
        'Do not assume api is available in non-admin turns.',
      ],
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
    'Voice analytics and past voice summaries belong to discord_context, not this live-control tool.',
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
  avoidWhen: [
    'The answer is purely Discord-internal.',
    'A GitHub repo or npm package tool is a better source.',
    'Broad canonical topic grounding from Wikipedia is enough.',
    'Coding Q&A or accepted-answer hunting is better served by Stack Overflow search.',
  ],
  routingNotes: [
    'Use research for one-shot search plus grounded reads.',
    'Use search for discovery only, then read or read.page once you know the URL.',
    'Use read.page for very large pages.',
  ],
  selectionHints: [
    'IF the question needs public internet information or fresh sources -> web.',
    '  - For broad or open-ended questions, ALWAYS use web (action=research) to search and read multiple sources in a single payload round.',
    '  - Broad canonical topic grounding with no freshness requirement -> wikipedia_search instead.',
    '  - Coding Q&A or accepted-answer hunting -> stack_overflow_search instead.',
    '  - Read a known page directly -> web (action=read) or web (action=read.page) for long pages.',
    '  - If you must read multiple URLs from a search (action=search), ALWAYS batch multiple web (action=read) calls in parallel within the same JSON payload.',
    '  - Use web (action=extract) only when raw page content is not enough and the user needs targeted agentic extraction.',
    '  - If unsure which web action fits, call web: help.',
  ],
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
      avoidWhen: [
        'You already know the exact page you want to read; use read or read.page.',
        'You want one-shot search plus grounded reads; use research.',
      ],
      requiredFields: ['action', 'query'],
      optionalFields: ['depth', 'maxResults'],
      defaults: ['depth defaults to the runtime search profile.'],
      examples: [{ action: 'search', query: 'latest Node.js release notes', depth: 'balanced', maxResults: 5 }],
    },
    {
      action: 'read',
      purpose: 'Fetch the main content from a known URL.',
      useWhen: ['You already know the page you want to read.'],
      avoidWhen: [
        'The page is large enough that paged reading would be safer; use read.page.',
        'You still need discovery across multiple sources; use search or research.',
      ],
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
      avoidWhen: ['A normal page read already gives enough information; use read or read.page.'],
      requiredFields: ['action', 'url', 'instruction'],
      optionalFields: ['maxChars'],
      examples: [{ action: 'extract', url: 'https://example.com/pricing', instruction: 'Extract plan names and monthly prices.' }],
    },
    {
      action: 'research',
      purpose: 'Run one-shot search plus grounded reads of top sources.',
      useWhen: ['You want a compact search + read workflow in one call.'],
      avoidWhen: [
        'You already know the exact page you want to read; use read or read.page.',
        'You only need discovery and not grounded page reads yet; use search.',
      ],
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
  avoidWhen: [
    'The package source is unknown and npm_info or workflow can resolve it first.',
    'The request is general web research rather than GitHub data.',
    'You only need npm registry metadata.',
  ],
  routingNotes: [
    'When the path is unknown, start with code.search.',
    'Prefer file.page, file.ranges, or file.snippet for large files.',
    'Use workflow when you want npm package resolution plus GitHub code search in one call.',
  ],
  selectionHints: [
    'IF the request is about GitHub repository data -> github.',
    '  - npm metadata only -> npm_info instead.',
    '  - npm package to GitHub code search in one call -> workflow instead.',
    '  - When the file path is unknown, start with github (action=code.search).',
    '  - Read exact files or ranges only after you know the path -> file.get / file.page / file.ranges / file.snippet.',
    '  - Repo metadata or README lookup -> repo.get.',
    '  - Issues or pull request history -> issues.search / prs.search.',
    '  - Recent repository activity -> commits.list.',
    '  - If unsure which GitHub action fits, call github: help.',
  ],
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
      avoidWhen: ['You need to locate code and do not know the path yet; use code.search first.'],
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
      commonMistakes: [
        'Do not call file.get before code.search when the path is still unknown.',
        'Use file.page, file.ranges, or file.snippet instead of one large file.get when the file is big.',
      ],
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
  avoidWhen: [
    'A direct tool call is simpler or the workflow does not match the task.',
    'You already know the GitHub repo and can go straight to github.',
    'You only need npm registry metadata.',
  ],
  routingNotes: [
    'Workflow actions are convenience wrappers over lower-level tools.',
    'Use workflow when the value is fewer hops, not when a direct tool already cleanly fits.',
  ],
  selectionHints: [
    'IF a composed workflow can replace multiple manual tool hops -> workflow.',
    '  - Start with workflow (action=help) when you want a one-shot wrapper over lower-level tools.',
    '  - If you already know the GitHub repo and only need GitHub data -> github instead.',
    '  - If you only need npm registry metadata -> npm_info instead.',
    '  - npm package -> GitHub code search in one call -> action=npm.github_code_search.',
  ],
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
      avoidWhen: [
        'You already know the GitHub repo and can call github directly.',
        'You only need npm registry metadata and not GitHub code search.',
      ],
      requiredFields: ['action', 'packageName', 'query'],
      optionalFields: ['version', 'ref', 'regex', 'pathFilter', 'maxCandidates', 'maxFilesToScan', 'maxMatches', 'includeTextMatches'],
      resultNotes: ['Fails with not_found when the package metadata does not expose a GitHub repo.'],
      examples: [{ action: 'npm.github_code_search', packageName: 'zod', query: 'safeParse', includeTextMatches: true }],
      commonMistakes: [
        'Do not use this when npm_info alone answers the question.',
        'Do not use this when the GitHub repo is already known and github can search directly.',
      ],
    },
  ],
});

const WEBSITE_COLORS = {
  discord: '#7AA2F7',
  search: '#E0AF68',
  dev: '#BB9AF7',
  gen: '#78b846',
  system: '#78b846',
} as const;

type DiscordActionWebsiteDoc = {
  short: string;
  desc: string;
};

const discordActionWebsiteDocs: Record<string, DiscordActionWebsiteDoc> = {
  help: { short: 'Help', desc: 'Get usage instructions and action help' },
  get_user_profile: { short: 'User Profile', desc: 'Retrieve a user best-effort personalization profile and preferences' },
  get_channel_summary: { short: 'Channel Summary', desc: 'Retrieve rolling and long-term summary context for the current channel' },
  search_channel_summary_archives: { short: 'Search Summaries', desc: 'Search archived channel summaries and long-term context' },
  get_server_instructions: { short: 'Read Sage Persona', desc: 'Read the guild-scoped Sage Persona configuration' },
  get_social_graph: { short: 'Social Graph', desc: 'Analyze user interaction graphs and network centrality' },
  get_top_relationships: { short: 'Top Relationships', desc: 'List the strongest interaction pairs across the server' },
  get_voice_analytics: { short: 'Voice Analytics', desc: 'Retrieve voice channel participation analytics' },
  get_voice_summaries: { short: 'Voice Summaries', desc: 'Get summarized transcripts from voice sessions' },
  search_history: { short: 'Search History', desc: 'Hybrid semantic, keyword, or regex history search with time filters' },
  search_with_context: { short: 'Search+Context', desc: 'Search history and expand surrounding message context in one call' },
  get_context: { short: 'Msg Window', desc: 'Fetch messages before and after a known message ID' },
  search_guild: { short: 'Search Guild', desc: 'Cross-channel message search across the server when allowed' },
  get_user_timeline: { short: 'User Timeline', desc: 'Recent messages from a user across the server when allowed' },
  send: { short: 'Send Message', desc: 'Send a plain or Components V2 message' },
  create_poll: { short: 'Create Poll', desc: 'Create an interactive Discord poll' },
  add_reaction: { short: 'Add Reaction', desc: 'Add emoji reactions to existing messages' },
  remove_self_reaction: { short: 'Remove Reaction', desc: 'Remove Sage-owned emoji reactions from messages' },
  list_channel: { short: 'Channel Files', desc: 'List files shared in the current channel' },
  list_server: { short: 'Server Files', desc: 'List files shared across the entire server when allowed' },
  find_channel: { short: 'Search Ch. Files', desc: 'Search indexed attachment text in the current channel' },
  find_server: { short: 'Search Sv. Files', desc: 'Search indexed attachment text across the server when allowed' },
  read_attachment: { short: 'Read Attachment', desc: 'Read cached attachment text in pages' },
  send_attachment: { short: 'Send Attachment', desc: 'Resend a cached file or image while returning its stored recall text' },
  list_channels: { short: 'List Channels', desc: 'Inspect accessible channels, categories, and forum/media surfaces' },
  get_channel: { short: 'Get Channel', desc: 'Inspect one channel with metadata and permission overwrites' },
  list_roles: { short: 'List Roles', desc: 'List guild roles with compact permission summaries' },
  list_threads: { short: 'List Threads', desc: 'List active or archived threads for a guild or channel' },
  get_thread: { short: 'Get Thread', desc: 'Inspect one thread state, ownership, and archive settings' },
  list_scheduled_events: { short: 'List Events', desc: 'List upcoming or active scheduled events' },
  get_scheduled_event: { short: 'Get Event', desc: 'Inspect one scheduled event' },
  create_thread: { short: 'Create Thread', desc: 'Start a new conversation thread' },
  update_thread: { short: 'Update Thread', desc: 'Rename or change archive and lock state for a thread' },
  join_thread: { short: 'Join Thread', desc: 'Join a thread as Sage' },
  leave_thread: { short: 'Leave Thread', desc: 'Leave a thread as Sage' },
  add_thread_member: { short: 'Add Member', desc: 'Add a member to a thread' },
  remove_thread_member: { short: 'Remove Member', desc: 'Remove a member from a thread' },
  list_members: { short: 'List Members', desc: 'Admin-only member lookup with query or role filtering' },
  get_member: { short: 'Get Member', desc: 'Admin-only inspection for one guild member' },
  get_permission_snapshot: { short: 'Perm Snapshot', desc: 'Admin-only resolved channel permissions for a member or role' },
  list_automod_rules: { short: 'AutoMod Rules', desc: 'Admin-only summary of current AutoMod rules' },
  update_server_instructions: { short: 'Update Sage Persona', desc: 'Queue an admin-approved Sage Persona change' },
  get_server_key_status: { short: 'Key Status', desc: 'Admin-only status check for the current server API key' },
  get_governance_review_status: { short: 'Review Status', desc: 'Inspect where governance review cards are routed for this server' },
  clear_server_api_key: { short: 'Clear Server Key', desc: 'Admin-only removal of the current server API key' },
  set_governance_review_channel: { short: 'Set Review Ch.', desc: 'Route detailed governance review cards to a dedicated admin channel' },
  clear_governance_review_channel: { short: 'Clear Review Ch.', desc: 'Return governance review cards to source-channel default routing' },
  send_key_setup_card: { short: 'Send Setup Card', desc: 'Post the interactive server-key setup card into the current channel' },
  submit_moderation: { short: 'Mod Queue', desc: 'Queue moderation actions based on policy' },
  edit_message: { short: 'Edit Message', desc: 'Modify contents of an existing bot message' },
  delete_message: { short: 'Delete Message', desc: 'Delete an offending message' },
  pin_message: { short: 'Pin Message', desc: 'Pin an important message to the channel' },
  unpin_message: { short: 'Unpin Message', desc: 'Unpin a message from the channel' },
  create_channel: { short: 'Create Channel', desc: 'Create a new text, voice, or category channel' },
  edit_channel: { short: 'Edit Channel', desc: 'Modify channel settings or placement' },
  create_role: { short: 'Create Role', desc: 'Create a new server role' },
  edit_role: { short: 'Edit Role', desc: 'Modify existing server role settings or permissions' },
  delete_role: { short: 'Delete Role', desc: 'Delete a server role' },
  add_member_role: { short: 'Add Role', desc: 'Assign a role to a server member' },
  remove_member_role: { short: 'Remove Role', desc: 'Remove a role from a server member' },
  get_invite_url: { short: 'Invite URL', desc: 'Generate a bot installation invite link' },
  api: { short: 'Discord API', desc: 'Raw Discord REST fallback after typed admin actions' },
  get_status: { short: 'Voice Status', desc: 'Check whether Sage is currently connected to voice' },
  join_current_channel: { short: 'Join Voice', desc: 'Join the invoker current standard voice channel' },
  leave: { short: 'Leave Voice', desc: 'Leave the active guild voice channel' },
};

function registerRoutedTopLevelToolDoc(
  routedDoc: RoutedToolDoc,
  options: {
    website: Omit<WebsiteNativeToolRow, 'name'>;
    smoke: ToolSmokeDoc;
    promptGuidance?: PromptToolGuidance;
    validationHint?: string;
  },
): TopLevelToolDoc {
  return registerTopLevelToolDoc({
    tool: routedDoc.tool,
    purpose: routedDoc.purpose,
    selectionHints: [...(routedDoc.selectionHints ?? [])],
    avoidWhen: routedDoc.avoidWhen ? [...routedDoc.avoidWhen] : undefined,
    promptGuidance: options.promptGuidance,
    validationHint:
      options.validationHint ??
      'Try: { action: "help" } to see available actions and example payloads.',
    website: {
      name: routedDoc.tool,
      ...options.website,
    },
    smoke: options.smoke,
  });
}

const PROMPT_GUIDANCE_ANTI_PATTERNS = {
  nativeDeliveryNeedsSend:
    'Do not leave an in-channel delivery in plain prose when discord_messages.send should deliver it.',
} as const;

registerTopLevelToolDoc({
  tool: 'system_time',
  purpose: 'Calculate timezone offsets when the runtime prompt current UTC timestamp is not enough.',
  selectionHints: [
    'IF timezone conversion for a specific utcOffset -> system_time (the current UTC time is already in <agent_state>; use the tool only for explicit offset math).',
  ],
  promptGuidance: {
    purpose: 'Timezone math when <agent_state> UTC is not enough.',
    decisionEdges: [
      'Specific timezone conversion or offset math -> system_time.',
    ],
    antiPatterns: [
      'Do not call it just to know the current UTC time already exposed in <agent_state>.',
    ],
  },
  validationHint:
    'Try: {} for current UTC facts or { utcOffsetMinutes: 480 } for explicit timezone conversion.',
  website: {
    name: 'system_time',
    short: 'DateTime',
    desc: 'Get current UTC facts or apply explicit timezone-offset math',
    cat: 'system',
    color: WEBSITE_COLORS.system,
  },
  smoke: {
    mode: 'required',
    args: {},
  },
});

registerTopLevelToolDoc({
  tool: 'system_tool_stats',
  purpose: 'Inspect in-process tool telemetry such as latency, failures, and cache or memo activity.',
  selectionHints: [
    'IF tool latency, cache, memo, or error telemetry is needed -> system_tool_stats.',
  ],
  promptGuidance: {
    purpose: 'Process-local tool telemetry and cache or memo stats.',
    decisionEdges: [
      'Tool latency, failures, cache, or memo behavior -> system_tool_stats.',
    ],
  },
  validationHint:
    'Try: { topN: 10 } for a compact summary or { includeRaw: true } for full in-process metrics.',
  website: {
    name: 'system_tool_stats',
    short: 'Tool Stats',
    desc: 'Inspect in-process tool latency, caching, memoization, and failure stats',
    cat: 'system',
    color: WEBSITE_COLORS.system,
  },
  smoke: {
    mode: 'required',
    args: { topN: 5 },
  },
});

registerRoutedTopLevelToolDoc(discordContextToolDoc, {
  website: {
    short: 'Discord Context',
    desc: 'Profiles, rolling summaries, instruction reads, and analytics',
    cat: 'discord',
    color: WEBSITE_COLORS.discord,
  },
  smoke: {
    mode: 'skip',
    reason: 'Requires live guild and current-turn context; covered by runtime, unit, and integration tests.',
  },
  promptGuidance: {
    purpose: 'Profiles, summaries, relationships, and Sage Persona reads.',
    decisionEdges: [
      'Room recap, profile context, relationship context, or a guild Sage Persona read -> discord_context.',
      'Exact quotes, message proof, or local message windows -> discord_messages instead.',
      'Live voice state, join, or leave -> discord_voice instead.',
    ],
    helpHint: 'If the exact context contract is genuinely unclear, call `discord_context` with `action: "help"`.',
  },
  validationHint: 'Try: { action: "help" } to see available actions and required fields.',
});

registerRoutedTopLevelToolDoc(discordMessagesToolDoc, {
  website: {
    short: 'Discord Messages',
    desc: 'Exact message history, message windows, delivery, reactions, and polls',
    cat: 'discord',
    color: WEBSITE_COLORS.discord,
  },
  smoke: {
    mode: 'skip',
    reason: 'Requires live guild and current-turn context; covered by runtime, unit, and integration tests.',
  },
  promptGuidance: {
    purpose: 'Exact message evidence and Discord-native delivery.',
    decisionEdges: [
      'Exact quotes, message proof, who-said-what, or local message windows -> discord_messages.',
      'Final in-channel rich or interactive reply -> discord_messages.send.',
      'Thread lifecycle or guild-resource state -> discord_server instead.',
    ],
    antiPatterns: [
      PROMPT_GUIDANCE_ANTI_PATTERNS.nativeDeliveryNeedsSend,
    ],
    helpHint: 'If the exact message contract or send payload is genuinely unclear, call `discord_messages` with `action: "help"`.',
  },
  validationHint: 'Try: { action: "help" } to see available actions and required fields.',
});

registerRoutedTopLevelToolDoc(discordFilesToolDoc, {
  website: {
    short: 'Discord Files',
    desc: 'Attachment discovery, file search, paging, and resend flows',
    cat: 'discord',
    color: WEBSITE_COLORS.discord,
  },
  smoke: {
    mode: 'skip',
    reason: 'Requires live guild and current-turn context; covered by runtime, unit, and integration tests.',
  },
  promptGuidance: {
    purpose: 'Attachment recall and cached attachment text.',
    decisionEdges: [
      'Uploaded files, cached attachment text, or "show that again" -> discord_files.',
      'Message history, exact quotes, or who-said-what -> discord_messages instead.',
      'Channels, roles, threads, or guild resources -> discord_server instead.',
    ],
    helpHint: 'If the exact attachment contract is genuinely unclear, call `discord_files` with `action: "help"`.',
  },
  validationHint: 'Try: { action: "help" } to see available actions and required fields.',
});

registerRoutedTopLevelToolDoc(discordServerToolDoc, {
  website: {
    short: 'Discord Server',
    desc: 'Guild resources, admin-only reads, scheduled events, and thread lifecycle',
    cat: 'discord',
    color: WEBSITE_COLORS.discord,
  },
  smoke: {
    mode: 'skip',
    reason: 'Requires live guild and current-turn context; covered by runtime, unit, and integration tests.',
  },
  promptGuidance: {
    purpose: 'Guild resources and thread lifecycle.',
    decisionEdges: [
      'Channels, roles, threads, members, events, permissions, or AutoMod -> discord_server.',
      'Attachment recall -> discord_files instead.',
      'Exact message evidence or in-channel reply delivery -> discord_messages instead.',
    ],
    helpHint: 'If the exact guild-resource contract is genuinely unclear, call `discord_server` with `action: "help"`.',
  },
  validationHint: 'Try: { action: "help" } to see available actions and required fields.',
});

registerRoutedTopLevelToolDoc(discordVoiceToolDoc, {
  website: {
    short: 'Discord Voice',
    desc: 'Live voice connection status and commandless join or leave control',
    cat: 'discord',
    color: WEBSITE_COLORS.discord,
  },
  smoke: {
    mode: 'skip',
    reason: 'Requires live guild and current-turn context; covered by runtime, unit, and integration tests.',
  },
  promptGuidance: {
    purpose: 'Live voice status and join/leave control.',
    decisionEdges: [
      'Voice status or join or leave -> discord_voice.',
      'Voice analytics or past voice summaries -> discord_context instead.',
    ],
    helpHint: 'If the exact voice contract is genuinely unclear, call `discord_voice` with `action: "help"`.',
  },
  validationHint: 'Try: { action: "help" } to see available actions and required fields.',
});

registerRoutedTopLevelToolDoc(discordAdminToolDoc, {
  website: {
    short: 'Discord Admin',
    desc: 'Admin writes, moderation, invite URLs, and raw Discord API fallback',
    cat: 'discord',
    color: WEBSITE_COLORS.discord,
  },
  smoke: {
    mode: 'skip',
    reason: 'Requires live guild, admin turn state, and approval context; covered by runtime, unit, and integration tests.',
  },
  promptGuidance: {
    purpose: 'Governance changes, moderation, and API fallback.',
    decisionEdges: [
      'Change Sage behavior or governance config -> discord_admin.',
      'Enforce on user or content -> discord_admin.submit_moderation.',
      'Use discord_admin.api only when typed Discord actions do not cover the task.',
    ],
    antiPatterns: [
      'Do not use generic delete_message for reply-targeted spam or abuse when submit_moderation fits better.',
    ],
    helpHint: 'If the exact admin contract is genuinely unclear, call `discord_admin` with `action: "help"`.',
  },
  validationHint: 'Try: { action: "help" } to see available actions and required fields.',
});

registerTopLevelToolDoc({
  tool: 'image_generate',
  purpose: 'Generate an image attachment when the user explicitly wants a visual created.',
  selectionHints: [
    'IF image creation, illustration, or visual mockup generation is requested -> image_generate.',
  ],
  promptGuidance: {
    purpose: 'Create an image attachment from a prompt.',
    decisionEdges: [
      'Image creation, illustration, or visual mockup request -> image_generate.',
    ],
  },
  validationHint:
    'Try: { prompt: "minimal geometric poster of a robot librarian" } and optionally add width, height, model, seed, or referenceImageUrl.',
  website: {
    name: 'image_generate',
    short: 'Image Gen',
    desc: 'Generate images from a prompt with optional reference-image guidance',
    cat: 'gen',
    color: WEBSITE_COLORS.gen,
  },
  smoke: {
    mode: 'optional',
    args: {
      prompt: 'minimal geometric poster of a robot librarian',
      width: 512,
      height: 512,
    },
  },
});

registerRoutedTopLevelToolDoc(webToolDoc, {
  website: {
    short: 'Web',
    desc: 'Unified web research with search, page reads, extraction, and one-shot research',
    cat: 'search',
    color: WEBSITE_COLORS.search,
  },
  smoke: {
    mode: 'required',
    args: {
      action: 'research',
      query: 'latest OpenAI release notes',
      maxResults: 4,
      maxSources: 2,
    },
  },
  promptGuidance: {
    purpose: 'Fresh web research.',
    decisionEdges: [
      'Fresh external facts or open web research -> web.',
      'Canonical topic grounding with no freshness requirement -> wikipedia_search instead.',
      'Coding Q&A or accepted-answer hunting -> stack_overflow_search instead.',
      'Discord-internal questions -> use Discord tools instead.',
    ],
    antiPatterns: [
      'Avoid sequential page-by-page read loops; batch reads or use research.',
    ],
    helpHint: 'If the exact web contract is genuinely unclear, call `web` with `action: "help"`.',
  },
});

registerRoutedTopLevelToolDoc(githubToolDoc, {
  website: {
    short: 'GitHub',
    desc: 'Unified GitHub repo, code, file, issue, PR, and commit lookup',
    cat: 'dev',
    color: WEBSITE_COLORS.dev,
  },
  smoke: {
    mode: 'required',
    args: {
      action: 'repo.get',
      repo: 'openai/openai-node',
      includeReadme: false,
    },
  },
  promptGuidance: {
    purpose: 'GitHub repos, code, files, PRs, and commits.',
    decisionEdges: [
      'GitHub repository or code lookup -> github.',
      'Unknown file path -> `code.search` first.',
      'npm registry metadata only -> npm_info instead.',
      'npm package to GitHub code search in one hop -> workflow instead.',
    ],
    helpHint: 'If the exact GitHub contract is genuinely unclear, call `github` with `action: "help"`.',
  },
});

registerRoutedTopLevelToolDoc(workflowToolDoc, {
  website: {
    short: 'Workflow',
    desc: 'Composable one-shot workflows that reduce multi-hop tool chains',
    cat: 'dev',
    color: WEBSITE_COLORS.dev,
  },
  smoke: {
    mode: 'required',
    args: {
      action: 'npm.github_code_search',
      packageName: 'zod',
      query: 'safeParse',
      includeTextMatches: true,
      maxCandidates: 5,
      maxFilesToScan: 5,
      maxMatches: 5,
    },
  },
  promptGuidance: {
    purpose: 'One-shot multi-hop wrappers.',
    decisionEdges: [
      'One call can replace a routine multi-hop chain -> workflow.',
      'npm package plus GitHub code search -> `workflow` with `action="npm.github_code_search"`.',
      'Known GitHub repo and direct GitHub data -> github instead.',
    ],
    antiPatterns: [],
    helpHint: 'If the exact workflow contract is genuinely unclear, call `workflow` with `action: "help"`.',
  },
  validationHint: 'Try: { action: "help" } to see available workflows and example payloads.',
});

registerTopLevelToolDoc({
  tool: 'npm_info',
  purpose: 'Lookup npm package metadata, versions, maintainers, and normalized repository hints.',
  selectionHints: [
    'IF npm package metadata, versions, maintainers, or repository hints are needed -> npm_info.',
  ],
  promptGuidance: {
    purpose: 'npm metadata and repo hints.',
    decisionEdges: [
      'npm package metadata, maintainers, or repo hint -> npm_info.',
      'Need GitHub repo or code lookup after you know the repo -> github instead.',
    ],
  },
  validationHint:
    'Try: { packageName: "zod" } and optionally add { version: "latest" } or a specific version tag.',
  website: {
    name: 'npm_info',
    short: 'NPM Package',
    desc: 'Lookup npm package details, versions, maintainers, and repository hints',
    cat: 'dev',
    color: WEBSITE_COLORS.dev,
  },
  smoke: {
    mode: 'required',
    args: {
      packageName: 'zod',
    },
  },
});

registerTopLevelToolDoc({
  tool: 'wikipedia_search',
  purpose: 'Lookup broad, canonical encyclopedia-style topic grounding from Wikipedia.',
  selectionHints: [
    'IF broad encyclopedia facts or canonical topic grounding is needed -> wikipedia_search.',
  ],
  promptGuidance: {
    purpose: 'Canonical encyclopedia grounding.',
    decisionEdges: [
      'Broad canonical topic grounding -> wikipedia_search.',
      'Fresh, time-sensitive, or multi-source facts -> web instead.',
    ],
  },
  validationHint:
    'Try: { query: "OpenAI", maxResults: 3 } and optionally add { language: "en" }.',
  website: {
    name: 'wikipedia_search',
    short: 'Wikipedia',
    desc: 'Search Wikipedia pages with snippets and canonical article links',
    cat: 'search',
    color: WEBSITE_COLORS.search,
  },
  smoke: {
    mode: 'required',
    args: {
      query: 'OpenAI',
      maxResults: 3,
    },
  },
});

registerTopLevelToolDoc({
  tool: 'stack_overflow_search',
  purpose: 'Search Stack Overflow questions and optionally fetch an accepted answer body for coding help.',
  selectionHints: [
    'IF coding Q&A or accepted-answer solution hunting is needed -> stack_overflow_search.',
    '  - Set includeAcceptedAnswer=true when the accepted answer body itself is needed.',
  ],
  promptGuidance: {
    purpose: 'Coding Q&A and accepted answers.',
    decisionEdges: [
      'Coding Q&A or accepted-answer solution hunting -> stack_overflow_search.',
      'Need the accepted answer body itself -> set `includeAcceptedAnswer=true`.',
      'Fresh docs, product facts, or open-web research -> web instead.',
    ],
  },
  validationHint:
    'Try: { query: "TypeScript zod schema parse error", includeAcceptedAnswer: true } and optionally add tagged or maxResults.',
  website: {
    name: 'stack_overflow_search',
    short: 'Stack Overflow',
    desc: 'Search Stack Overflow questions and accepted-answer coding fixes',
    cat: 'search',
    color: WEBSITE_COLORS.search,
  },
  smoke: {
    mode: 'required',
    args: {
      query: 'TypeScript zod schema parse error',
      tagged: 'typescript',
      maxResults: 3,
    },
  },
});

function buildDiscordActionWebsiteRow(action: RoutedToolActionDoc): WebsiteNativeToolRow {
  const override = discordActionWebsiteDocs[action.action];
  return {
    name: action.action,
    short: override?.short ?? action.action.replaceAll('_', ' '),
    desc: override?.desc ?? action.purpose,
    cat: 'discord',
    color: WEBSITE_COLORS.discord,
  };
}

export function listSmokeToolDocs(): TopLevelToolDoc[] {
  return listTopLevelToolDocs().filter((doc) => doc.smoke.mode !== 'skip');
}

export function buildWebsiteNativeTools(): WebsiteNativeToolRow[] {
  const rows: WebsiteNativeToolRow[] = [];
  const addTopLevelTool = (toolName: string): void => {
    const doc = getTopLevelToolDoc(toolName);
    if (!doc) {
      throw new Error(`No top-level tool documentation registered for "${toolName}".`);
    }
    rows.push({ ...doc.website });
  };

  for (const toolName of [
    'discord_context',
    'discord_messages',
    'discord_files',
    'discord_server',
    'discord_voice',
    'discord_admin',
  ]) {
    addTopLevelTool(toolName);
  }

  const seenDiscordActions = new Set<string>();
  for (const toolName of [
    'discord_context',
    'discord_messages',
    'discord_server',
    'discord_files',
    'discord_admin',
    'discord_voice',
  ]) {
    const routedDoc = getRoutedToolDoc(toolName);
    if (!routedDoc) continue;
    for (const action of routedDoc.actions) {
      if (seenDiscordActions.has(action.action)) continue;
      seenDiscordActions.add(action.action);
      rows.push(buildDiscordActionWebsiteRow(action));
    }
  }

  for (const toolName of ['web', 'wikipedia_search', 'stack_overflow_search']) {
    addTopLevelTool(toolName);
  }
  for (const toolName of ['github', 'npm_info', 'workflow']) {
    addTopLevelTool(toolName);
  }
  addTopLevelTool('image_generate');
  for (const toolName of ['system_time', 'system_tool_stats']) {
    addTopLevelTool(toolName);
  }

  return rows;
}
