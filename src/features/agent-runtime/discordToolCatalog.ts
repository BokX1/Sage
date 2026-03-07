export const DISCORD_CONTEXT_ACTION_CATALOG = {
  read_only: [
    'help',
    'get_user_profile',
    'get_channel_summary',
    'search_channel_summary_archives',
    'get_server_instructions',
    'get_social_graph',
    'get_top_relationships',
    'get_voice_analytics',
    'get_voice_summaries',
  ],
  writes: [],
  admin_only: [],
} as const;

export const DISCORD_MESSAGES_ACTION_CATALOG = {
  read_only: [
    'help',
    'search_history',
    'search_with_context',
    'get_context',
    'search_guild',
    'get_user_timeline',
  ],
  writes: [
    'send',
    'create_poll',
    'create_thread',
    'add_reaction',
    'remove_self_reaction',
  ],
  admin_only: [],
} as const;

export const DISCORD_FILES_ACTION_CATALOG = {
  read_only: [
    'help',
    'list_channel',
    'list_server',
    'find_channel',
    'find_server',
    'read_attachment',
  ],
  writes: ['send_attachment'],
  admin_only: [],
} as const;

export const DISCORD_ADMIN_ACTION_CATALOG = {
  read_only: ['help', 'get_invite_url'],
  writes: [],
  admin_only: [
    'update_server_instructions',
    'submit_moderation',
    'edit_message',
    'delete_message',
    'pin_message',
    'unpin_message',
    'create_channel',
    'edit_channel',
    'create_role',
    'edit_role',
    'delete_role',
    'add_member_role',
    'remove_member_role',
    'api',
  ],
} as const;

export const DISCORD_TOOL_ACTION_CATALOG = {
  discord_context: DISCORD_CONTEXT_ACTION_CATALOG,
  discord_messages: DISCORD_MESSAGES_ACTION_CATALOG,
  discord_files: DISCORD_FILES_ACTION_CATALOG,
  discord_admin: DISCORD_ADMIN_ACTION_CATALOG,
} as const;

export const DISCORD_GUARDRAILS = [
  'Writes are disallowed in autopilot turns.',
  'Admin-only actions require admin context; API passthrough is guild-scoped and approval-gated for non-GET writes.',
  'API passthrough blocks bot-wide endpoints (for example /users/@me) and direct /webhooks/* routes.',
  'API passthrough redacts sensitive fields (tokens/secrets) from results.',
  'Some actions require a guild context (guildId). If no guildId is available, avoid guild-only actions.',
] as const;

type DiscordActionCatalog = {
  read_only: readonly string[];
  writes: readonly string[];
  admin_only: readonly string[];
};

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

export function getDiscordActionCatalogForTool(toolName: string): DiscordActionCatalog | null {
  return (
    DISCORD_TOOL_ACTION_CATALOG[toolName as keyof typeof DISCORD_TOOL_ACTION_CATALOG] ?? null
  );
}

export function getAllDiscordActions(): string[] {
  return dedupePreserveOrder(
    Object.values(DISCORD_TOOL_ACTION_CATALOG).flatMap((catalog) => [
      ...catalog.read_only,
      ...catalog.writes,
      ...catalog.admin_only,
    ]),
  );
}

export function formatDiscordGuardrailsLines(): string[] {
  return DISCORD_GUARDRAILS.map((line) => `Discord guardrail: ${line}`);
}
