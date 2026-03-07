export const DISCORD_ACTION_CATALOG = {
  read_only: [
    'help',
    'memory.get_user',
    'memory.get_channel',
    'memory.channel_archives',
    'memory.get_server',
    'files.list_channel',
    'files.list_server',
    'files.find_channel',
    'files.find_server',
    'files.read_attachment',
    'messages.search_history',
    'messages.search_with_context',
    'messages.get_context',
    'messages.search_guild',
    'messages.user_timeline',
    'analytics.get_social_graph',
    'analytics.top_relationships',
    'analytics.get_voice_analytics',
    'analytics.voice_summaries',
    'oauth2.invite_url',
  ],
  writes: [
    'files.send_attachment',
    'messages.send',
    'polls.create',
    'threads.create',
    'reactions.add',
    'reactions.remove_self',
  ],
  admin_only: [
    'memory.update_server',
    'moderation.submit',
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
    'discord.api',
  ],
} as const;

/**
 * Declares exported bindings: DISCORD_GUARDRAILS.
 */
export const DISCORD_GUARDRAILS = [
  'Writes are disallowed in autopilot turns.',
  'Admin-only actions require admin context; API calls are guild-scoped and approval-gated for non-GET writes.',
  'API passthrough blocks bot-wide endpoints (for example /users/@me) and direct /webhooks/* routes.',
  'API passthrough redacts sensitive fields (tokens/secrets) from results.',
  'Some actions require a guild context (guildId). If no guildId is available, avoid guild-only actions.',
] as const;

/**
 * Represents the DiscordActionCatalog type.
 */
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

export function formatDiscordGuardrailsLines(): string[] {
  return DISCORD_GUARDRAILS.map((line) => `Discord guardrail: ${line}`);
}
