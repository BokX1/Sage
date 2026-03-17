export const DISCORD_CONTEXT_ACTION_CATALOG = {
  read_only: [
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
    'search_history',
    'search_with_context',
    'get_context',
    'search_guild',
    'get_user_timeline',
  ],
  writes: [
    'create_poll',
    'add_reaction',
    'remove_self_reaction',
  ],
  admin_only: [],
} as const;

export const DISCORD_FILES_ACTION_CATALOG = {
  read_only: [
    'list_channel',
    'list_server',
    'find_channel',
    'find_server',
    'read_attachment',
  ],
  writes: ['send_attachment'],
  admin_only: [],
} as const;

export const DISCORD_SERVER_ACTION_CATALOG = {
  read_only: [
    'list_channels',
    'get_channel',
    'list_roles',
    'list_threads',
    'get_thread',
    'list_scheduled_events',
    'get_scheduled_event',
  ],
  writes: [
    'create_thread',
    'update_thread',
    'join_thread',
    'leave_thread',
    'add_thread_member',
    'remove_thread_member',
  ],
  admin_only: [
    'list_members',
    'get_member',
    'get_permission_snapshot',
    'list_automod_rules',
  ],
} as const;

export const DISCORD_ADMIN_ACTION_CATALOG = {
  read_only: ['get_invite_url'],
  writes: [],
  admin_only: [
    'get_server_key_status',
    'get_governance_review_status',
    'clear_server_api_key',
    'set_governance_review_channel',
    'clear_governance_review_channel',
    'send_key_setup_card',
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

export const DISCORD_VOICE_ACTION_CATALOG = {
  read_only: ['get_status'],
  writes: ['join_current_channel', 'leave'],
  admin_only: [],
} as const;

export const DISCORD_TOOL_ACTION_CATALOG = {
  discord_context: DISCORD_CONTEXT_ACTION_CATALOG,
  discord_messages: DISCORD_MESSAGES_ACTION_CATALOG,
  discord_files: DISCORD_FILES_ACTION_CATALOG,
  discord_server: DISCORD_SERVER_ACTION_CATALOG,
  discord_admin: DISCORD_ADMIN_ACTION_CATALOG,
  discord_voice: DISCORD_VOICE_ACTION_CATALOG,
} as const;

export const DISCORD_GUARDRAILS = [
  'Writes are disallowed in autopilot turns.',
  'Governance/admin actions require admin context; moderation actions require the relevant Discord moderation permissions; API passthrough is guild-scoped and approval-gated for non-GET writes.',
  'API passthrough blocks bot-wide endpoints (for example /users/@me) and direct /webhooks/* routes.',
  'API passthrough redacts sensitive fields (tokens/secrets) from results.',
  'Some actions require a guild context (guildId). If no guildId is available, avoid guild-only actions.',
] as const;

type DiscordActionCatalog = {
  read_only: readonly string[];
  writes: readonly string[];
  admin_only: readonly string[];
};

export function getDiscordActionCatalogForTool(toolName: string): DiscordActionCatalog | null {
  return (
    DISCORD_TOOL_ACTION_CATALOG[toolName as keyof typeof DISCORD_TOOL_ACTION_CATALOG] ?? null
  );
}

export function formatDiscordGuardrailsLines(): string[] {
  return DISCORD_GUARDRAILS.map((line) => `Discord guardrail: ${line}`);
}
