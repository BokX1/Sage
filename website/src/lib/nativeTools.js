export const nativeTools = [
  { name: 'discord_context', short: 'Discord Context', desc: 'Profiles, summaries, server instructions reads, and analytics', cat: 'discord', color: '#7AA2F7' },
  { name: 'discord_messages', short: 'Discord Messages', desc: 'Exact message history, Discord-native delivery, reactions, and polls', cat: 'discord', color: '#7AA2F7' },
  { name: 'discord_files', short: 'Discord Files', desc: 'Attachment discovery, recall, paging, and resend flows', cat: 'discord', color: '#7AA2F7' },
  { name: 'discord_server', short: 'Discord Server', desc: 'Guild resources, scheduled events, AutoMod reads, and thread lifecycle', cat: 'discord', color: '#7AA2F7' },
  { name: 'discord_admin', short: 'Discord Admin', desc: 'Admin writes, moderation, invite URLs, and raw Discord API fallback', cat: 'discord', color: '#7AA2F7' },

  // Discord (cyan)
  { name: 'help', short: 'Help', desc: 'Get usage instructions and command help', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_user_profile', short: 'User Profile', desc: 'Retrieve a user best-effort personalization profile and preferences', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_channel_summary', short: 'Channel Summary', desc: 'Retrieve rolling and long-term summary context for the current channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'search_channel_summary_archives', short: 'Search Summaries', desc: 'Search archived channel summaries and long-term context', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_server_instructions', short: 'Server Instructions', desc: 'Retrieve guild-specific bot instructions and persona rules', cat: 'discord', color: '#7AA2F7' },
  { name: 'list_channels', short: 'List Channels', desc: 'Inspect accessible channels, categories, and forum/media surfaces', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_channel', short: 'Get Channel', desc: 'Inspect one channel with metadata and permission overwrites', cat: 'discord', color: '#7AA2F7' },
  { name: 'list_roles', short: 'List Roles', desc: 'List guild roles with compact permission summaries', cat: 'discord', color: '#7AA2F7' },
  { name: 'list_threads', short: 'List Threads', desc: 'List active or archived threads for a guild/channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_thread', short: 'Get Thread', desc: 'Inspect one thread state, ownership, and archive settings', cat: 'discord', color: '#7AA2F7' },
  { name: 'list_scheduled_events', short: 'List Events', desc: 'List upcoming or active scheduled events', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_scheduled_event', short: 'Get Event', desc: 'Inspect one scheduled event', cat: 'discord', color: '#7AA2F7' },
  { name: 'list_members', short: 'List Members', desc: 'Admin-only member lookup with query or role filtering', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_member', short: 'Get Member', desc: 'Admin-only inspection for one guild member', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_permission_snapshot', short: 'Perm Snapshot', desc: 'Admin-only resolved channel permissions for a member or role', cat: 'discord', color: '#7AA2F7' },
  { name: 'list_automod_rules', short: 'AutoMod Rules', desc: 'Admin-only summary of current AutoMod rules', cat: 'discord', color: '#7AA2F7' },
  { name: 'list_channel', short: 'Channel Files', desc: 'Look up files shared in the current channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'list_server', short: 'Server Files', desc: 'Look up files shared across the entire server', cat: 'discord', color: '#7AA2F7' },
  { name: 'find_channel', short: 'Search Ch. Files', desc: 'Search indexed attachment text in the current channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'find_server', short: 'Search Sv. Files', desc: 'Search for specific file types or names in the server', cat: 'discord', color: '#7AA2F7' },
  { name: 'read_attachment', short: 'Read Attachment', desc: 'Read cached attachment text in pages (continuation-friendly)', cat: 'discord', color: '#7AA2F7' },
  { name: 'search_history', short: 'Search History', desc: 'Hybrid semantic/keyword/regex search (time-windowed)', cat: 'discord', color: '#7AA2F7' },
  { name: 'search_with_context', short: 'Search+Context', desc: 'Search + expand surrounding context in one call', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_context', short: 'Get Context', desc: 'Fetch messages before/after a message ID', cat: 'discord', color: '#7AA2F7' },
  { name: 'search_guild', short: 'Search Guild', desc: 'Cross-channel message search across the server (permission-filtered)', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_user_timeline', short: 'User Timeline', desc: 'Recent messages from a user across the server (permission-filtered)', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_social_graph', short: 'Social Graph', desc: 'Analyze user interaction graphs and network centrality', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_top_relationships', short: 'Top Relationships', desc: 'List the strongest interaction pairs across the server', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_voice_analytics', short: 'Voice Analytics', desc: 'Retrieve voice channel participation analytics', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_voice_summaries', short: 'Voice Summaries', desc: 'Get summarized transcripts from voice sessions', cat: 'discord', color: '#7AA2F7' },
  { name: 'get_invite_url', short: 'Invite URL', desc: 'Generate a bot installation invite link', cat: 'discord', color: '#7AA2F7' },

  // Discord (cyan) - Writes
  { name: 'send_attachment', short: 'Send Attachment', desc: 'Resend a cached file or image while returning its stored recall text', cat: 'discord', color: '#7AA2F7' },
  { name: 'send', short: 'Send Message', desc: 'Send a plain or Components V2 message', cat: 'discord', color: '#7AA2F7' },
  { name: 'create_poll', short: 'Create Poll', desc: 'Create an interactive Discord poll', cat: 'discord', color: '#7AA2F7' },
  { name: 'create_thread', short: 'Create Thread', desc: 'Start a new conversation thread', cat: 'discord', color: '#7AA2F7' },
  { name: 'update_thread', short: 'Update Thread', desc: 'Rename or change archive and lock state for a thread', cat: 'discord', color: '#7AA2F7' },
  { name: 'join_thread', short: 'Join Thread', desc: 'Join a thread as Sage', cat: 'discord', color: '#7AA2F7' },
  { name: 'leave_thread', short: 'Leave Thread', desc: 'Leave a thread as Sage', cat: 'discord', color: '#7AA2F7' },
  { name: 'add_thread_member', short: 'Add Member', desc: 'Add a member to a thread', cat: 'discord', color: '#7AA2F7' },
  { name: 'remove_thread_member', short: 'Remove Member', desc: 'Remove a member from a thread', cat: 'discord', color: '#7AA2F7' },
  { name: 'add_reaction', short: 'Add Reaction', desc: 'Add emoji reactions to existing messages', cat: 'discord', color: '#7AA2F7' },
  { name: 'remove_self_reaction', short: 'Remove Reaction', desc: 'Remove own emoji reactions from messages', cat: 'discord', color: '#7AA2F7' },

  // Discord (cyan) - Admin Only
  { name: 'update_server_instructions', short: 'Update Instructions', desc: 'Queue an admin-approved update to server instructions', cat: 'discord', color: '#7AA2F7' },
  { name: 'submit_moderation', short: 'Mod Queue', desc: 'Queue moderation actions based on policy', cat: 'discord', color: '#7AA2F7' },
  { name: 'edit_message', short: 'Edit Message', desc: 'Modify contents of an existing bot message', cat: 'discord', color: '#7AA2F7' },
  { name: 'delete_message', short: 'Delete Message', desc: 'Delete an offending message (Admin only)', cat: 'discord', color: '#7AA2F7' },
  { name: 'pin_message', short: 'Pin Message', desc: 'Pin an important message to the channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'unpin_message', short: 'Unpin Message', desc: 'Unpin a message from the channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'create_channel', short: 'Create Channel', desc: 'Create a new text or voice channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'edit_channel', short: 'Edit Channel', desc: 'Modify channel settings or permissions', cat: 'discord', color: '#7AA2F7' },
  { name: 'create_role', short: 'Create Role', desc: 'Create a new server role', cat: 'discord', color: '#7AA2F7' },
  { name: 'edit_role', short: 'Edit Role', desc: 'Modify existing server role permissions', cat: 'discord', color: '#7AA2F7' },
  { name: 'delete_role', short: 'Delete Role', desc: 'Delete a server role', cat: 'discord', color: '#7AA2F7' },
  { name: 'add_member_role', short: 'Add Role', desc: 'Assign a role to a server member', cat: 'discord', color: '#7AA2F7' },
  { name: 'remove_member_role', short: 'Remove Role', desc: 'Remove a role from a server member', cat: 'discord', color: '#7AA2F7' },
  { name: 'api', short: 'Discord API', desc: 'Raw Discord REST passthrough (admin-only, guild-scoped)', cat: 'discord', color: '#7AA2F7' },

  // Search (amber)
  { name: 'web', short: 'Web', desc: 'Unified web research (search/read/extract/research) with provider fallback', cat: 'search', color: '#E0AF68' },
  { name: 'wikipedia_search', short: 'Wikipedia', desc: 'Search and extract Wikipedia articles', cat: 'search', color: '#E0AF68' },
  { name: 'stack_overflow_search', short: 'Stack Overflow', desc: 'Search Stack Overflow for code solutions', cat: 'search', color: '#E0AF68' },

  // Dev (purple)
  { name: 'github', short: 'GitHub', desc: 'Unified GitHub (repo/code/file paging+ranges/issues+PRs/commits)', cat: 'dev', color: '#BB9AF7' },
  { name: 'npm_info', short: 'NPM Package', desc: 'Lookup npm package details and versions', cat: 'dev', color: '#BB9AF7' },
  { name: 'workflow', short: 'Workflow', desc: 'Composable one-shot workflows (e.g. npm → GitHub code search)', cat: 'dev', color: '#BB9AF7' },

  // Generation (green)
  { name: 'image_generate', short: 'Image Gen', desc: 'Generate images with agentic prompt refinement', cat: 'gen', color: '#78b846' },

  // System (green)
  { name: 'system_plan', short: 'Reflection', desc: 'Internal reasoning step before complex actions', cat: 'system', color: '#78b846' },
  { name: 'system_time', short: 'DateTime', desc: 'Get current date, time, and UTC offset', cat: 'system', color: '#78b846' },
  { name: 'system_tool_stats', short: 'Tool Stats', desc: 'Inspect in-process tool latency, caching, and failure stats', cat: 'system', color: '#78b846' },
];

export const nativeToolCount = nativeTools.length;
