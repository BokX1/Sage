export const DISCORD_ACTION_CATALOG = {
  read_only: [
    'help',
    'memory.get_user',
    'memory.get_channel',
    'memory.search_channel_archives',
    'memory.get_server',
    'files.lookup_channel',
    'files.lookup_server',
    'files.search_channel',
    'files.search_server',
    'messages.search_history',
    'messages.get_context',
    'analytics.get_social_graph',
    'analytics.get_voice_analytics',
    'analytics.get_voice_session_summaries',
    'oauth2.get_bot_invite_url',
  ],
  writes: [
    'messages.send',
    'polls.create',
    'threads.create',
    'reactions.add',
    'reactions.remove_self',
  ],
  admin_only: [
    'memory.queue_server_update',
    'moderation.queue',
    'messages.edit',
    'messages.delete',
    'messages.pin',
    'messages.unpin',
    'channels.create',
    'channels.edit',
    'roles.create',
    'roles.edit',
    'roles.delete',
    'members.add_role',
    'members.remove_role',
    'rest',
  ],
} as const;

export const DISCORD_GUARDRAILS = [
  'Writes are disallowed in autopilot turns.',
  'Admin-only actions require admin context; REST is guild-scoped and approval-gated for non-GET writes.',
  'REST passthrough blocks bot-wide endpoints (for example /users/@me) and direct /webhooks/* routes.',
  'REST passthrough redacts sensitive fields (tokens/secrets) from results.',
  'Some actions require a guild context (guildId). If no guildId is available, avoid guild-only actions.',
  'When possible, batch independent read-only tool calls into a single tool_calls envelope to reduce round-trips.',
] as const;

export type DiscordActionCatalog = typeof DISCORD_ACTION_CATALOG;

function dedupePreserveOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function getAllDiscordActions(): string[] {
  return dedupePreserveOrder([
    ...DISCORD_ACTION_CATALOG.read_only,
    ...DISCORD_ACTION_CATALOG.writes,
    ...DISCORD_ACTION_CATALOG.admin_only,
  ]);
}

function formatActionList(values: readonly string[]): string {
  return values.join(', ');
}

export function formatDiscordActionIndexLines(): string[] {
  return [
    `Discord actions (read-only): ${formatActionList(DISCORD_ACTION_CATALOG.read_only)}`,
    `Discord actions (writes; not autopilot): ${formatActionList(DISCORD_ACTION_CATALOG.writes)}`,
    `Discord actions (admin-only): ${formatActionList(DISCORD_ACTION_CATALOG.admin_only)}`,
  ];
}

export function formatDiscordGuardrailsLines(): string[] {
  return DISCORD_GUARDRAILS.map((line) => `Discord guardrail: ${line}`);
}
