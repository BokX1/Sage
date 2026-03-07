export const nativeTools = [
  // Discord (cyan)
  { name: 'help', short: 'Help', desc: 'Get usage instructions and command help', cat: 'discord', color: '#7AA2F7' },
  { name: 'profile.get_user', short: 'User Profile', desc: 'Retrieve a user best-effort personalization profile and preferences', cat: 'discord', color: '#7AA2F7' },
  { name: 'summary.get_channel', short: 'Channel Summary', desc: 'Retrieve rolling and long-term summary context for the current channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'summary.search_channel_archives', short: 'Search Summaries', desc: 'Search archived channel summaries and long-term context', cat: 'discord', color: '#7AA2F7' },
  { name: 'instructions.get_server', short: 'Server Instructions', desc: 'Retrieve guild-specific bot instructions and persona rules', cat: 'discord', color: '#7AA2F7' },
  { name: 'files.list_channel', short: 'Channel Files', desc: 'Look up files shared in a specific channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'files.list_server', short: 'Server Files', desc: 'Look up files shared across the entire server', cat: 'discord', color: '#7AA2F7' },
  { name: 'files.find_channel', short: 'Search Ch. Files', desc: 'Search for specific file types or names in a channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'files.find_server', short: 'Search Sv. Files', desc: 'Search for specific file types or names in the server', cat: 'discord', color: '#7AA2F7' },
  { name: 'files.read_attachment', short: 'Read Attachment', desc: 'Read cached attachment text in pages (continuation-friendly)', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.search_history', short: 'Search History', desc: 'Hybrid semantic/keyword/regex search (time-windowed)', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.search_with_context', short: 'Search+Context', desc: 'Search + expand surrounding context in one call', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.get_context', short: 'Get Context', desc: 'Fetch messages before/after a message ID', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.search_guild', short: 'Search Guild', desc: 'Cross-channel message search across the server (permission-filtered)', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.user_timeline', short: 'User Timeline', desc: 'Recent messages from a user across the server (permission-filtered)', cat: 'discord', color: '#7AA2F7' },
  { name: 'analytics.get_social_graph', short: 'Social Graph', desc: 'Analyze user interaction graphs and network centrality', cat: 'discord', color: '#7AA2F7' },
  { name: 'analytics.top_relationships', short: 'Top Relationships', desc: 'List a user’s strongest relationships by interaction weight', cat: 'discord', color: '#7AA2F7' },
  { name: 'analytics.get_voice_analytics', short: 'Voice Analytics', desc: 'Retrieve voice channel participation analytics', cat: 'discord', color: '#7AA2F7' },
  { name: 'analytics.voice_summaries', short: 'Voice Summaries', desc: 'Get summarized transcripts from voice sessions', cat: 'discord', color: '#7AA2F7' },
  { name: 'oauth2.invite_url', short: 'Invite URL', desc: 'Generate a bot installation invite link', cat: 'discord', color: '#7AA2F7' },

  // Discord (cyan) - Writes
  { name: 'files.send_attachment', short: 'Send Attachment', desc: 'Resend a cached file or image while returning its stored recall text', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.send', short: 'Send Message', desc: 'Send a new message or rich embed to a channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'polls.create', short: 'Create Poll', desc: 'Create an interactive Discord poll', cat: 'discord', color: '#7AA2F7' },
  { name: 'threads.create', short: 'Create Thread', desc: 'Start a new conversation thread', cat: 'discord', color: '#7AA2F7' },
  { name: 'reactions.add', short: 'Add Reaction', desc: 'Add emoji reactions to existing messages', cat: 'discord', color: '#7AA2F7' },
  { name: 'reactions.remove_self', short: 'Remove Reaction', desc: 'Remove own emoji reactions from messages', cat: 'discord', color: '#7AA2F7' },

  // Discord (cyan) - Admin Only
  { name: 'instructions.update_server', short: 'Update Instructions', desc: 'Queue an admin-approved update to server instructions', cat: 'discord', color: '#7AA2F7' },
  { name: 'moderation.submit', short: 'Mod Queue', desc: 'Queue moderation actions based on policy', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.edit', short: 'Edit Message', desc: 'Modify contents of an existing bot message', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.delete', short: 'Delete Message', desc: 'Delete an offending message (Admin only)', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.pin', short: 'Pin Message', desc: 'Pin an important message to the channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'messages.unpin', short: 'Unpin Message', desc: 'Unpin a message from the channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'channels.create', short: 'Create Channel', desc: 'Create a new text or voice channel', cat: 'discord', color: '#7AA2F7' },
  { name: 'channels.edit', short: 'Edit Channel', desc: 'Modify channel settings or permissions', cat: 'discord', color: '#7AA2F7' },
  { name: 'roles.create', short: 'Create Role', desc: 'Create a new server role', cat: 'discord', color: '#7AA2F7' },
  { name: 'roles.edit', short: 'Edit Role', desc: 'Modify existing server role permissions', cat: 'discord', color: '#7AA2F7' },
  { name: 'roles.delete', short: 'Delete Role', desc: 'Delete a server role', cat: 'discord', color: '#7AA2F7' },
  { name: 'members.add_role', short: 'Add Role', desc: 'Assign a role to a server member', cat: 'discord', color: '#7AA2F7' },
  { name: 'members.remove_role', short: 'Remove Role', desc: 'Remove a role from a server member', cat: 'discord', color: '#7AA2F7' },
  { name: 'discord.api', short: 'Discord API', desc: 'Raw Discord REST passthrough (admin-only, guild-scoped)', cat: 'discord', color: '#7AA2F7' },

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
